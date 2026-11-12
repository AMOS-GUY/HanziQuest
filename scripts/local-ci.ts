/**
 * Local CI (temporary, while GitHub Actions minutes are exhausted until 2026-12-01).
 * Reproduces .github/workflows/ci.yml (`verify` and `docker` jobs) on this machine, in the same
 * order, against DISPOSABLE local databases only. See docs/LOCAL_CI.md.
 *
 *   npm run ci:local                    # everything CI runs that this machine can run
 *   npm run ci:local -- --fresh         # final runs: clean tree required, build artifacts removed
 *   npm run ci:local -- --keep-going    # don't stop at the first failure
 *   npm run ci:local -- --install       # step 01 runs `npm ci` (reinstalls node_modules)
 *   npm run ci:local -- --with-firefox  # also the advisory Firefox e2e step
 *   npm run ci:local -- --skip-e2e      # quick runs only: NOT a full CI equivalent
 *
 * Every step is reported as PASS, FAIL, BLOCKED (a tool or environment this machine lacks:
 * nothing was run, nothing is claimed) or NOT RUN (skipped by a flag or after a failure).
 * "Local equivalent" steps check the same behaviour without the CI tool (for example the
 * container's start command without Docker) and are labelled as such, never as the CI step.
 *
 * Safety:
 * - Refuses to start if any database variable in the environment (after loading .env) is not
 *   local, or if any value contains a host from .env.staging.local. That file is never loaded.
 * - Every step gets an environment built here: DATABASE_URL / TEST_DATABASE_URL point at fresh
 *   `hq_localci_<run>*` databases on the local server. MIGRATE_DATABASE_URL, DRILL_DATABASE_URL,
 *   SEED_TARGET, ALLOW_REMOTE_DATABASE, APP_ENV, RENDER, E2E_BASE_URL and STAGING_* are removed.
 * - The disposable databases are dropped at the end, also after a failure.
 * - Logs go to .local/local-ci/<run>/ (git-ignored), with connection strings and the
 *   ephemeral AUTH_SECRET masked.
 */
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";
interface Result {
  id: string;
  ci: string; // the ci.yml step it reproduces
  name: string;
  status: Status;
  seconds: number;
  note?: string;
  advisory?: boolean;
}

const args = new Set(process.argv.slice(2));
const KEEP_GOING = args.has("--keep-going");
const FRESH = args.has("--fresh");
const LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"];
const run = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(2).toString("hex")}`;
const logDir = path.join(".local", "local-ci", run);
const results: Result[] = [];
const authSecret = randomBytes(32).toString("base64");

// ── Preflight: local databases only ─────────────────────────────────────────────
function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}
function stagingHosts(): Set<string> {
  const hosts = new Set<string>();
  if (!fs.existsSync(".env.staging.local")) return hosts;
  for (const line of fs.readFileSync(".env.staging.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"\s]+)"?/);
    const h = hostOf(m?.[1]);
    if (h) {
      hosts.add(h);
      hosts.add(h.replace(/^([^.]+)-pooler\./, "$1."));
    }
  }
  return hosts;
}
function preflight() {
  for (const name of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "MIGRATE_DATABASE_URL",
    "DRILL_DATABASE_URL",
  ]) {
    const v = process.env[name];
    if (v && !LOCAL.includes(hostOf(v)))
      throw new Error(`Refusing: ${name} is not a local database. Local CI only uses localhost.`);
  }
  const staging = stagingHosts();
  for (const [name, value] of Object.entries(process.env))
    for (const h of staging)
      if (value?.includes(h))
        throw new Error(`Refusing: ${name} contains a staging host. Local CI never uses staging.`);
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL in .env to the local database (npm run db:local).");
}

const dbUrl = (name: string) => {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${name}`;
  return u.toString();
};
const DB = `hq_localci_${randomBytes(3).toString("hex")}`;
const MAIN = dbUrl(DB);
const TEST = dbUrl(`${DB}_test`);
const RESTORE = dbUrl(`${DB}_restore`);

async function adminQuery<T extends pg.QueryResultRow>(sql: string) {
  const c = new pg.Client({ connectionString: dbUrl("postgres") });
  await c.connect();
  try {
    return (await c.query<T>(sql)).rows;
  } finally {
    await c.end();
  }
}
const createDb = (name: string) => adminQuery(`CREATE DATABASE "${name}"`);
async function dropDbs() {
  for (const n of [DB, `${DB}_test`, `${DB}_restore`])
    await adminQuery(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`).catch(() => undefined);
}

// ── Step environment (what CI's job-level env provides) ───────────────────────────
function stepEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env))
    if (
      /^(MIGRATE_DATABASE_URL|DRILL_DATABASE_URL|SEED_TARGET|ALLOW_REMOTE_DATABASE|APP_ENV|RENDER|E2E_BASE_URL|STAGING_.*)$/.test(
        k,
      )
    )
      delete env[k];
  return {
    ...env,
    DATABASE_URL: MAIN,
    TEST_DATABASE_URL: TEST,
    AUTH_URL: "http://localhost:3100",
    AUTH_TRUST_HOST: "true",
    AUTH_SECRET: authSecret,
    CI: "true",
    // CI's seed creates no admin; empty values stop dotenv from adding the local ones from .env.
    SEED_ADMIN_EMAIL: "",
    SEED_ADMIN_PASSWORD: "",
    ...extra,
  };
}

function mask(text: string) {
  return text
    .replace(/postgres(ql)?:\/\/\S+/g, "postgresql://[masked]")
    .split(authSecret)
    .join("[auth-secret]");
}
/** The first line that looks like the actual error, else the last non-empty line. */
function reason(out: string) {
  const lines = out.split("\n").filter((l) => l.trim());
  const hit = lines.find((l) =>
    /(\bError:|✗|FAILED|failed|Refusing|spawn UNKNOWN|ERR!|error TS\d+)/.test(l),
  );
  return (hit ?? lines.at(-1) ?? "").trim().slice(0, 220);
}

// ── Running steps ─────────────────────────────────────────────────────────────────
let stopped = false;
function push(r: Result) {
  results.push(r);
  const label = r.advisory && r.status === "FAIL" ? "FAIL (advisory)" : r.status;
  console.log(`${label} (${r.seconds}s)${r.status === "PASS" ? "" : ` — ${r.note ?? ""}`}`);
}
function sh(
  id: string,
  ci: string,
  name: string,
  command: string,
  opts: {
    extraEnv?: Record<string, string>;
    advisory?: boolean;
    timeoutMs?: number;
    blockedIf?: RegExp;
  } = {},
) {
  process.stdout.write(`▶ ${id} ${name} … `);
  if (stopped) {
    push({ id, ci, name, status: "NOT RUN", seconds: 0, note: "an earlier step failed" });
    return false;
  }
  const t0 = Date.now();
  const r = spawnSync(command, {
    shell: true,
    env: stepEnv(opts.extraEnv),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 30 * 60_000,
  });
  const out = mask(`$ ${command}\n${r.stdout ?? ""}${r.stderr ?? ""}\n[exit code ${r.status}]\n`);
  fs.writeFileSync(path.join(logDir, `${id}.log`), out);
  const ok = r.status === 0;
  const seconds = Math.round((Date.now() - t0) / 1000);
  const blocked = !ok && opts.blockedIf?.test(out);
  const status: Status = ok ? "PASS" : blocked ? "BLOCKED" : "FAIL";
  push({
    id,
    ci,
    name,
    status,
    seconds,
    advisory: opts.advisory,
    note: ok ? undefined : `${blocked ? "environment: " : ""}${reason(out)} (log ${id}.log)`,
  });
  if (status === "FAIL" && !opts.advisory) {
    console.log(out.split("\n").slice(-25).join("\n").replace(/^/gm, "    "));
    if (!KEEP_GOING) stopped = true;
  }
  return ok;
}
function record(id: string, ci: string, name: string, status: Status, note: string) {
  process.stdout.write(`▶ ${id} ${name} … `);
  push({ id, ci, name, status, seconds: 0, note });
}
const has = (cmd: string) =>
  spawnSync(`${cmd} --version`, { stdio: "ignore", shell: true }).status === 0;

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Starts `node node_modules/next/dist/bin/next start` (the Dockerfile's CMD) and runs `check`. */
async function withServer(
  port: number,
  extraEnv: Record<string, string>,
  check: (base: string, log: () => string) => Promise<{ ok: boolean; out: string }>,
) {
  let server: ChildProcess | null = null;
  let log = "";
  try {
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
      {
        env: stepEnv({ AUTH_URL: `http://localhost:${port}`, NODE_ENV: "production", ...extraEnv }),
      },
    );
    server.stdout?.on("data", (d) => (log += d));
    server.stderr?.on("data", (d) => (log += d));
    return await check(`http://localhost:${port}`, () => log);
  } finally {
    server?.kill();
  }
}

async function smoke() {
  const id = "21";
  const ci = "Smoke test (production server)";
  const name = "Smoke test (production server :3200)";
  process.stdout.write(`▶ ${id} ${name} … `);
  if (stopped)
    return push({ id, ci, name, status: "NOT RUN", seconds: 0, note: "an earlier step failed" });
  const t0 = Date.now();
  const { ok, out } = await withServer(3200, {}, async (base, log) => {
    // CI waits for /api/health (readiness); same here.
    const up = await waitFor(`${base}/api/health`, 60_000);
    if (!up) return { ok: false, out: `${log()}\nserver didn't become ready in 60 s` };
    const r = spawnSync(`npm run smoke -- ${base}`, {
      shell: true,
      env: stepEnv(),
      encoding: "utf8",
    });
    return { ok: r.status === 0, out: `${log()}\n${r.stdout}${r.stderr}\n[exit code ${r.status}]` };
  });
  const masked = mask(out);
  fs.writeFileSync(path.join(logDir, `${id}.log`), masked);
  push({
    id,
    ci,
    name,
    status: ok ? "PASS" : "FAIL",
    seconds: Math.round((Date.now() - t0) / 1000),
    note: ok ? undefined : `${reason(masked)} (log ${id}.log)`,
  });
  if (!ok && !KEEP_GOING) stopped = true;
}

/** Local equivalents of the docker job's behaviour checks, without Docker (labelled as such). */
async function containerEquivalents() {
  const startId = "23L";
  const startName =
    "LOCAL EQUIVALENT (no Docker): image CMD starts; liveness ok; readiness migrations ok";
  process.stdout.write(`▶ ${startId} ${startName} … `);
  if (stopped) {
    push({
      id: startId,
      ci: "Start-up test",
      name: startName,
      status: "NOT RUN",
      seconds: 0,
      note: "an earlier step failed",
    });
  } else {
    const t0 = Date.now();
    const { ok, out } = await withServer(3300, { APP_RELEASE: "localci" }, async (base, log) => {
      const up = await waitFor(`${base}/api/health/live`, 60_000);
      if (!up) return { ok: false, out: `${log()}\nno liveness in 60 s` };
      const live = (await (await fetch(`${base}/api/health/live`)).json()) as { status?: string };
      const ready = (await (await fetch(`${base}/api/health`)).json()) as { migrations?: string };
      const good = live.status === "ok" && ready.migrations === "ok";
      return {
        ok: good,
        out: `${log()}\nlive=${JSON.stringify(live)}\nready=${JSON.stringify(ready)}`,
      };
    });
    fs.writeFileSync(path.join(logDir, `${startId}.log`), mask(out));
    push({
      id: startId,
      ci: "Start-up test",
      name: startName,
      status: ok ? "PASS" : "FAIL",
      seconds: Math.round((Date.now() - t0) / 1000),
      note: ok ? undefined : `${reason(mask(out))} (log ${startId}.log)`,
    });
    if (!ok && !KEEP_GOING) stopped = true;
  }

  const refuseId = "24L";
  const refuseName = "LOCAL EQUIVALENT (no Docker): server refuses a placeholder AUTH_SECRET";
  process.stdout.write(`▶ ${refuseId} ${refuseName} … `);
  if (stopped) {
    push({
      id: refuseId,
      ci: "Refuses to start with a placeholder secret",
      name: refuseName,
      status: "NOT RUN",
      seconds: 0,
      note: "an earlier step failed",
    });
    return;
  }
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3301"],
    {
      env: stepEnv({
        NODE_ENV: "production",
        AUTH_SECRET: "build-time-placeholder-secret-not-used-at-runtime",
        AUTH_URL: "https://app.example.com",
      }),
      encoding: "utf8",
      timeout: 45_000,
    },
  );
  // A timeout (still running) or exit 0 means it did NOT refuse.
  const refused = r.status !== null && r.status !== 0;
  const out = mask(
    `${r.stdout ?? ""}${r.stderr ?? ""}\n[exit code ${r.status}${r.error ? `, ${r.error.message}` : ""}]`,
  );
  fs.writeFileSync(path.join(logDir, `${refuseId}.log`), out);
  push({
    id: refuseId,
    ci: "Refuses to start with a placeholder secret",
    name: refuseName,
    status: refused ? "PASS" : "FAIL",
    seconds: Math.round((Date.now() - t0) / 1000),
    note: refused ? `exit code ${r.status}` : `did not refuse (log ${refuseId}.log)`,
  });
  if (!refused && !KEEP_GOING) stopped = true;
}

function dockerJob() {
  if (!has("docker")) {
    record(
      "22",
      "Build production image",
      "docker: build production image",
      "BLOCKED",
      "Docker isn't installed on this machine",
    );
    record(
      "23",
      "Start-up test",
      "docker: start-up test in the container (non-root, SIGTERM stop < 15 s)",
      "BLOCKED",
      "needs Docker; app-level part covered by 23L",
    );
    record(
      "24",
      "Refuses to start with a placeholder secret",
      "docker: refusal inside the container",
      "BLOCKED",
      "needs Docker; process-level part covered by 24L",
    );
    return false;
  }
  // Same commands as the CI docker job, against the disposable local database. Docker Desktop
  // has no host networking, so the container reaches the host by name.
  const hostDb = MAIN.replace(/@(localhost|127\.0\.0\.1)/, "@host.docker.internal");
  sh(
    "22",
    "Build production image",
    "docker: build production image",
    "docker build -t hanziquest:localci .",
  );
  sh(
    "23",
    "Start-up test",
    "docker: start-up test in the container",
    [
      `docker run --rm -e DATABASE_URL="${hostDb}" hanziquest:localci node node_modules/prisma/build/index.js migrate deploy`,
      `docker run -d --name hq-localci -p 3400:3000 -e DATABASE_URL="${hostDb}" -e AUTH_SECRET="${authSecret}" -e AUTH_URL=http://localhost:3400 -e AUTH_TRUST_HOST=true -e APP_RELEASE=localci hanziquest:localci`,
      `node -e "(async()=>{for(let i=0;i<40;i++){try{if((await fetch('http://localhost:3400/api/health/live')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000))}const h=await (await fetch('http://localhost:3400/api/health')).json();if(h.migrations!=='ok')process.exit(1)})()"`,
      `node -e "if(require('child_process').execSync('docker exec hq-localci id -u').toString().trim()==='0')process.exit(1)"`,
      `node -e "const t=Date.now();require('child_process').execSync('docker stop -t 20 hq-localci');if((Date.now()-t)/1000>=15)process.exit(1)"`,
      "docker rm hq-localci",
    ].join(" && "),
  );
  sh(
    "24",
    "Refuses to start with a placeholder secret",
    "docker: refusal inside the container",
    `node -e "const r=require('child_process').spawnSync('docker',['run','--rm','-e','DATABASE_URL=${hostDb}','-e','AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime','-e','AUTH_URL=https://app.example.com','-e','AUTH_TRUST_HOST=true','hanziquest:localci','timeout','25','node','node_modules/next/dist/bin/next','start','-p','3001'],{stdio:'inherit'});if(r.status===124||r.status===0)process.exit(1)"`,
  );
  return true;
}

function git(cmd: string) {
  return spawnSync(`git ${cmd}`, { shell: true, encoding: "utf8" }).stdout.trim();
}

async function main() {
  preflight();
  const branch = git("branch --show-current");
  const dirty = git("status --porcelain");
  if (FRESH && dirty)
    throw new Error("--fresh needs a clean working tree. Commit or stash first:\n" + dirty);
  fs.mkdirSync(logDir, { recursive: true });
  if (FRESH)
    for (const d of [".next", "test-results", "playwright-report"])
      fs.rmSync(d, { recursive: true, force: true });
  const pgVersion =
    (await adminQuery<{ v: string }>("SELECT current_setting('server_version') AS v"))[0]?.v ?? "?";
  console.log(
    `Local CI ${run}: ${branch} @ ${git("rev-parse --short HEAD")}${dirty ? " (uncommitted changes!)" : ""}${FRESH ? " (fresh)" : ""}`,
  );
  console.log(`Node ${process.version}; local PostgreSQL ${pgVersion} (GitHub CI: postgres:17)`);
  console.log(`Disposable databases: ${DB}, ${DB}_test, ${DB}_restore (local server only)\n`);
  fs.writeFileSync(
    path.join(logDir, "env.txt"),
    `node ${process.version}\npostgres ${pgVersion}\n`,
  );
  await createDb(DB);

  // ── verify job, in ci.yml order ──
  record(
    "00",
    "actions/checkout + setup-node",
    "Checkout and Node",
    "PASS",
    `working tree on ${branch}; Node ${process.version} (CI: 24.x)`,
  );
  if (args.has("--install"))
    sh("01", "Install dependencies", "Install dependencies (npm ci)", "npm ci");
  else
    sh(
      "01",
      "Install dependencies",
      "Installed tree matches package-lock (npm ls --all)",
      "npm ls --all --silent",
    );
  sh(
    "02",
    "Dependency audit",
    "Dependency audit (production, high+)",
    "npm audit --omit=dev --audit-level=high",
    { blockedIf: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i },
  );
  // Pull-request equivalent: compare with origin/main (CI uses origin/<base_ref> on PRs).
  sh(
    "03",
    "Migration safety",
    "Migration safety",
    branch === "main"
      ? "npm run db:check-migrations"
      : "npm run db:check-migrations -- --base origin/main",
  );
  record(
    "04",
    "Generate ephemeral auth secret",
    "Generate ephemeral auth secret",
    "PASS",
    "random 32-byte secret for this run (masked in logs)",
  );
  sh("05", "Lint", "Lint", "npm run lint");
  sh("06", "Formatting", "Formatting", "npm run format:check");
  sh("07", "Type check", "Type check", "npm run typecheck");
  sh(
    "08",
    "Validate curriculum content",
    "Validate curriculum content",
    "npm run content:validate",
  );
  sh("09", "Unit tests", "Unit tests", "npm test");
  process.stdout.write(`▶ 10 Create test database … `);
  if (stopped)
    push({
      id: "10",
      ci: "Create test database",
      name: "Create test database",
      status: "NOT RUN",
      seconds: 0,
      note: "an earlier step failed",
    });
  else {
    await createDb(`${DB}_test`);
    push({
      id: "10",
      ci: "Create test database",
      name: "Create test database (Node pg; CI uses psql)",
      status: "PASS",
      seconds: 0,
    });
  }
  sh("11", "Integration tests", "Integration tests", "npm run test:integration");
  sh("12", "Migrate and seed", "Migrate and seed", "npm run db:deploy && npm run db:seed");
  // CI's "Backup and restore drill", one command per sub-step so each gets its own environment.
  const backupFile = path.join(logDir, "ci.ndjson.gz");
  if (!stopped) await createDb(`${DB}_restore`);
  sh(
    "13a",
    "Backup and restore drill",
    "Backup and restore drill: backup",
    `npm run db:backup -- --out "${backupFile}"`,
  );
  sh(
    "13b",
    "Backup and restore drill",
    "Backup and restore drill: migrate the restore database",
    "npx prisma migrate deploy",
    { extraEnv: { MIGRATE_DATABASE_URL: RESTORE, DATABASE_URL: RESTORE } },
  );
  sh(
    "13c",
    "Backup and restore drill",
    "Backup and restore drill: restore",
    `npm run db:restore -- --in "${backupFile}" --target "${RESTORE}"`,
  );
  sh(
    "13d",
    "Backup and restore drill",
    "Backup and restore drill: verify",
    `npm run db:verify -- --source "${MAIN}" --target "${RESTORE}"`,
  );
  const age = has("age");
  record(
    "14",
    "Install age (backup encryption)",
    "age available (CI: apt-get install age)",
    age ? "PASS" : "BLOCKED",
    age
      ? "age is installed"
      : "age isn't installed here: the backup drill's encryption round trip can't run",
  );
  sh("15", "Migration drill", "Migration drill", "npm run drill:migrations", {
    extraEnv: { DRILL_DATABASE_URL: MAIN },
  });
  sh(
    "16",
    "Backup drill (restore, tampering, encryption)",
    `Backup drill: restore and tampering${age ? " and encryption" : " (encryption part BLOCKED, see 14)"}`,
    "npm run drill:backup",
    { extraEnv: { DRILL_DATABASE_URL: MAIN } },
  );
  sh("17", "Production build", "Production build", "npm run build");
  sh(
    "18",
    "Install Playwright browser",
    "Playwright Chromium is installed (CI downloads it)",
    `node -e "const p=require('playwright').chromium.executablePath();if(!require('fs').existsSync(p))process.exit(1);console.log('chromium at',p)"`,
  );
  if (args.has("--skip-e2e"))
    record(
      "19",
      "End-to-end tests",
      "End-to-end tests (Chromium)",
      "NOT RUN",
      "--skip-e2e (this run is NOT a full CI equivalent)",
    );
  else
    sh("19", "End-to-end tests", "End-to-end tests (Chromium)", "npm run test:e2e", {
      timeoutMs: 40 * 60_000,
    });
  if (args.has("--with-firefox"))
    sh(
      "20",
      "End-to-end tests (Firefox, advisory)",
      "End-to-end tests (Firefox, advisory)",
      "npx playwright test --project=firefox",
      {
        extraEnv: { E2E_ALL_BROWSERS: "1" },
        advisory: true,
        blockedIf: /spawn UNKNOWN|side-by-side/i,
      },
    );
  else
    record(
      "20",
      "End-to-end tests (Firefox, advisory)",
      "End-to-end tests (Firefox, advisory)",
      "NOT RUN",
      "pass --with-firefox (advisory in CI too)",
    );
  await smoke();
  record(
    "--",
    "Upload Playwright report (on failure)",
    "Upload Playwright report",
    "NOT RUN",
    "no artifact store locally; reports stay in playwright-report/ and .local/local-ci/",
  );

  // ── docker job ──
  if (!dockerJob()) await containerEquivalents();
}

function summary(fatal?: string) {
  const counts: Record<string, number> = {};
  for (const r of results) {
    const k = r.advisory && r.status === "FAIL" ? "FAIL (advisory)" : r.status;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const failed = !!fatal || results.some((r) => r.status === "FAIL" && !r.advisory);
  const exitCode = failed ? 1 : 0;
  const lines = [
    `# Local CI run ${run}`,
    "",
    `- Commit: \`${git("rev-parse HEAD")}\` on \`${git("branch --show-current")}\`${git("status --porcelain") ? " (with uncommitted changes)" : ""}${FRESH ? ", fresh run" : ""}`,
    `- ${fs.existsSync(path.join(logDir, "env.txt")) ? fs.readFileSync(path.join(logDir, "env.txt"), "utf8").trim().replace(/\n/g, "; ") : ""} (GitHub CI: Node 24, postgres:17)`,
    `- Result: ${Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}; **exit code ${exitCode}**${fatal ? `; runner error: ${fatal}` : ""}`,
    "",
    "| # | ci.yml step | Local check | Result | Time | Note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.ci} | ${r.name} | ${r.advisory && r.status === "FAIL" ? "FAIL (advisory)" : r.status} | ${r.seconds}s | ${(r.note ?? "").replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  if (fs.existsSync(logDir)) fs.writeFileSync(path.join(logDir, "summary.md"), lines.join("\n"));
  console.log(`\n${lines.slice(4).join("\n")}\nLogs: ${logDir}`);
  return exitCode;
}

let fatal: string | undefined;
main()
  .catch((e) => {
    fatal = mask(e instanceof Error ? e.message : String(e));
    console.error(`\n✗ ${fatal}`);
  })
  .finally(async () => {
    await dropDbs();
    process.exitCode = summary(fatal);
  });
