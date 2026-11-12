/**
 * Local CI (temporary, while GitHub Actions minutes are exhausted until 2026-12-01).
 * Reproduces .github/workflows/ci.yml (`verify` and `docker` jobs) on this machine, in the same
 * order, against DISPOSABLE local databases only. See docs/LOCAL_CI.md.
 *
 *   npm run ci:local                    # everything CI runs that this machine can run
 *   npm run ci:local -- --keep-going    # don't stop at the first failure
 *   npm run ci:local -- --install       # also `npm ci` (reinstalls node_modules)
 *   npm run ci:local -- --with-firefox  # also the advisory Firefox e2e step
 *   npm run ci:local -- --skip-e2e      # skip browser tests (quick runs; not a full CI equivalent)
 *
 * Safety:
 * - Refuses to start if any database variable in the environment (after loading .env) is not
 *   local, or if any value matches a host from .env.staging.local. That file is never loaded.
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

type Status = "pass" | "fail" | "skip" | "unavailable" | "advisory-fail";
interface Result {
  id: string;
  name: string;
  status: Status;
  seconds: number;
  note?: string;
}

const args = new Set(process.argv.slice(2));
const KEEP_GOING = args.has("--keep-going");
const LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"];
const run = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(2).toString("hex")}`;
const logDir = path.join(".local", "local-ci", run);
fs.mkdirSync(logDir, { recursive: true });
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

const base = () => new URL(process.env.DATABASE_URL!);
const dbUrl = (name: string) => {
  const u = base();
  u.pathname = `/${name}`;
  return u.toString();
};
const DB = `hq_localci_${run.slice(-4)}${Date.now().toString(36).slice(-3)}`;
const MAIN = dbUrl(DB);
const TEST = dbUrl(`${DB}_test`);
const RESTORE = dbUrl(`${DB}_restore`);

async function admin(sql: string) {
  const c = new pg.Client({ connectionString: dbUrl("postgres") });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}
const createDb = (name: string) => admin(`CREATE DATABASE "${name}"`);
const dropDbs = async () => {
  for (const n of [DB, `${DB}_test`, `${DB}_restore`])
    await admin(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`).catch(() => undefined);
};

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
    // CI's seed has no admin; empty values stop dotenv from adding the local ones from .env.
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

// ── Running steps ─────────────────────────────────────────────────────────────────
let stopped = false;
function sh(
  id: string,
  name: string,
  command: string,
  opts: { extraEnv?: Record<string, string>; advisory?: boolean; timeoutMs?: number } = {},
) {
  if (stopped) {
    results.push({ id, name, status: "skip", seconds: 0, note: "not run: an earlier step failed" });
    return false;
  }
  const t0 = Date.now();
  process.stdout.write(`▶ ${id} ${name} … `);
  const r = spawnSync(command, {
    shell: true,
    env: stepEnv(opts.extraEnv),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 30 * 60_000,
  });
  const out = mask(`$ ${command}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
  fs.writeFileSync(path.join(logDir, `${id}.log`), out);
  const ok = r.status === 0;
  const seconds = Math.round((Date.now() - t0) / 1000);
  const status: Status = ok ? "pass" : opts.advisory ? "advisory-fail" : "fail";
  results.push({ id, name, status, seconds, note: ok ? undefined : lastLine(out) });
  console.log(`${status.toUpperCase()} (${seconds}s)`);
  if (!ok && !opts.advisory) {
    console.log(indent(out.split("\n").slice(-25).join("\n")));
    if (!KEEP_GOING) stopped = true;
  }
  return ok;
}
function note(id: string, name: string, status: Status, why: string) {
  results.push({ id, name, status, seconds: 0, note: why });
  console.log(`▶ ${id} ${name} … ${status.toUpperCase()}: ${why}`);
}
const lastLine = (s: string) =>
  s
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .at(-1)
    ?.slice(0, 200) ?? "";
const indent = (s: string) => s.replace(/^/gm, "    ");
const has = (cmd: string) =>
  spawnSync(cmd, ["--version"], { stdio: "ignore", shell: true }).status === 0;

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

async function smoke() {
  const id = "21";
  const name = "Smoke test (production server :3200)";
  if (stopped) return note(id, name, "skip", "not run: an earlier step failed");
  const t0 = Date.now();
  process.stdout.write(`▶ ${id} ${name} … `);
  let server: ChildProcess | null = null;
  let log = "";
  try {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3200"], {
      env: stepEnv({ AUTH_URL: "http://localhost:3200", NODE_ENV: "production" }),
    });
    server.stdout?.on("data", (d) => (log += d));
    server.stderr?.on("data", (d) => (log += d));
    // CI waits for /api/health (readiness); same here.
    const up = await waitFor("http://localhost:3200/api/health", 60_000);
    const r = up
      ? spawnSync("npm run smoke -- http://localhost:3200", {
          shell: true,
          env: stepEnv(),
          encoding: "utf8",
        })
      : null;
    const out = mask(`${log}\n${r?.stdout ?? ""}${r?.stderr ?? ""}`);
    fs.writeFileSync(path.join(logDir, `${id}.log`), out);
    const ok = up && r?.status === 0;
    const seconds = Math.round((Date.now() - t0) / 1000);
    results.push({
      id,
      name,
      status: ok ? "pass" : "fail",
      seconds,
      note: ok ? undefined : up ? lastLine(out) : "server didn't become ready in 60 s",
    });
    console.log(`${ok ? "PASS" : "FAIL"} (${seconds}s)`);
    if (!ok && !KEEP_GOING) stopped = true;
  } finally {
    server?.kill();
  }
}

function dockerJob() {
  if (!has("docker")) {
    note(
      "22",
      "docker: build production image",
      "unavailable",
      "Docker isn't installed on this machine",
    );
    note(
      "23",
      "docker: start-up test (migrate, live, ready, non-root, SIGTERM)",
      "unavailable",
      "needs Docker",
    );
    note("24", "docker: refuses a placeholder secret", "unavailable", "needs Docker");
    return;
  }
  // Same commands as the CI docker job, against the disposable local database (host network
  // isn't available on Docker Desktop, so the container reaches the host by name).
  const hostDb = MAIN.replace(/@(localhost|127\.0\.0\.1)/, "@host.docker.internal");
  sh("22", "docker: build production image", "docker build -t hanziquest:localci .");
  sh(
    "23",
    "docker: start-up test (migrate, live, ready, non-root, SIGTERM)",
    [
      `docker run --rm -e DATABASE_URL="${hostDb}" hanziquest:localci node node_modules/prisma/build/index.js migrate deploy`,
      `docker run -d --name hq-localci -p 3300:3000 -e DATABASE_URL="${hostDb}" -e AUTH_SECRET="${authSecret}" -e AUTH_URL=http://localhost:3300 -e AUTH_TRUST_HOST=true -e APP_RELEASE=localci hanziquest:localci`,
      `node -e "(async()=>{for(let i=0;i<40;i++){try{const r=await fetch('http://localhost:3300/api/health/live');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,1000))}const l=await (await fetch('http://localhost:3300/api/health/live')).json();const h=await (await fetch('http://localhost:3300/api/health')).json();if(l.status!=='ok'||h.migrations!=='ok')process.exit(1);console.log(l,h)})()"`,
      `node -e "const u=require('child_process').execSync('docker exec hq-localci id -u').toString().trim();if(u==='0'){console.error('runs as root');process.exit(1)}"`,
      `node -e "const t=Date.now();require('child_process').execSync('docker stop -t 20 hq-localci');const s=(Date.now()-t)/1000;console.log('stopped in',s,'s');if(s>=15)process.exit(1)"`,
      "docker rm hq-localci",
    ].join(" && "),
  );
  sh(
    "24",
    "docker: refuses a placeholder secret",
    `node -e "const r=require('child_process').spawnSync('docker',['run','--rm','-e','DATABASE_URL=${hostDb}','-e','AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime','-e','AUTH_URL=https://app.example.com','-e','AUTH_TRUST_HOST=true','hanziquest:localci','timeout','25','node','node_modules/next/dist/bin/next','start','-p','3001'],{stdio:'inherit'});if(r.status===124||r.status===0){console.error('did not refuse');process.exit(1)}console.log('refused, exit',r.status)"`,
  );
}

function git(cmd: string) {
  return spawnSync(`git ${cmd}`, { shell: true, encoding: "utf8" }).stdout.trim();
}

async function main() {
  preflight();
  const branch = git("branch --show-current");
  const commit = git("rev-parse --short HEAD");
  const dirty = git("status --porcelain").length > 0;
  console.log(`Local CI ${run} — ${branch} @ ${commit}${dirty ? " (uncommitted changes!)" : ""}`);
  console.log(`Disposable databases: ${DB}, ${DB}_test, ${DB}_restore (local server only)\n`);
  await createDb(DB);

  // ── verify job, in ci.yml order ──
  if (args.has("--install")) sh("01", "Install dependencies (npm ci)", "npm ci");
  else sh("01", "Installed dependencies match package-lock (npm ls)", "npm ls --all --silent");
  sh("02", "Dependency audit (production, high+)", "npm audit --omit=dev --audit-level=high");
  // Pull-request equivalent: compare with origin/main (CI uses origin/<base_ref> on PRs).
  sh(
    "03",
    "Migration safety",
    branch === "main"
      ? "npm run db:check-migrations"
      : "npm run db:check-migrations -- --base origin/main",
  );
  note(
    "04",
    "Generate ephemeral auth secret",
    "pass",
    "random 32-byte secret for this run (masked in logs)",
  );
  sh("05", "Lint", "npm run lint");
  sh("06", "Formatting", "npm run format:check");
  sh("07", "Type check", "npm run typecheck");
  sh("08", "Validate curriculum content", "npm run content:validate");
  sh("09", "Unit tests", "npm test");
  if (!stopped) {
    await createDb(`${DB}_test`);
    note("10", "Create test database", "pass", "fresh local database");
  } else note("10", "Create test database", "skip", "not run: an earlier step failed");
  sh("11", "Integration tests", "npm run test:integration");
  sh("12", "Migrate and seed", "npm run db:deploy && npm run db:seed");
  const backupFile = path.join(logDir, "ci.ndjson.gz");
  if (!stopped) await createDb(`${DB}_restore`);
  // CI's "Backup and restore drill", one command per sub-step so each gets its own environment.
  sh("13a", "Backup and restore drill: backup", `npm run db:backup -- --out "${backupFile}"`);
  sh("13b", "Backup and restore drill: migrate the restore database", "npx prisma migrate deploy", {
    extraEnv: { MIGRATE_DATABASE_URL: RESTORE, DATABASE_URL: RESTORE },
  });
  sh(
    "13c",
    "Backup and restore drill: restore",
    `npm run db:restore -- --in "${backupFile}" --target "${RESTORE}"`,
  );
  sh(
    "13d",
    "Backup and restore drill: verify",
    `npm run db:verify -- --source "${MAIN}" --target "${RESTORE}"`,
  );
  if (has("age")) note("14", "Install age (backup encryption)", "pass", "age is installed");
  else
    note(
      "14",
      "Install age (backup encryption)",
      "unavailable",
      "age isn't installed here; the backup drill skips its encryption round trip",
    );
  sh("15", "Migration drill", "npm run drill:migrations", {
    extraEnv: { DRILL_DATABASE_URL: MAIN },
  });
  sh("16", "Backup drill (restore, tampering, encryption)", "npm run drill:backup", {
    extraEnv: { DRILL_DATABASE_URL: MAIN },
  });
  sh("17", "Production build", "npm run build");
  note(
    "18",
    "Install Playwright browser",
    "pass",
    "Chromium already installed locally (CI downloads it)",
  );
  if (args.has("--skip-e2e")) note("19", "End-to-end tests (Chromium)", "skip", "--skip-e2e");
  else sh("19", "End-to-end tests (Chromium)", "npm run test:e2e", { timeoutMs: 40 * 60_000 });
  if (args.has("--with-firefox"))
    sh("20", "End-to-end tests (Firefox, advisory)", "npx playwright test --project=firefox", {
      extraEnv: { E2E_ALL_BROWSERS: "1" },
      advisory: true,
    });
  else
    note(
      "20",
      "End-to-end tests (Firefox, advisory)",
      "skip",
      "advisory in CI; pass --with-firefox (it doesn't start on this machine so far)",
    );
  await smoke();

  // ── docker job ──
  dockerJob();
}

function summary() {
  const commit = git("rev-parse HEAD");
  const counts = results.reduce<Record<string, number>>(
    (a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a),
    {},
  );
  const lines = [
    `# Local CI run ${run}`,
    "",
    `- Commit: \`${commit}\` on \`${git("branch --show-current")}\`${git("status --porcelain") ? " (with uncommitted changes)" : ""}`,
    `- Node ${process.version}; local PostgreSQL (CI uses postgres:17)`,
    `- Result: ${Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}`,
    "",
    "| # | Step | Result | Time | Note |",
    "| --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.name} | ${r.status} | ${r.seconds}s | ${(r.note ?? "").replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  fs.writeFileSync(path.join(logDir, "summary.md"), lines.join("\n"));
  console.log(`\n${lines.slice(4).join("\n")}\nLogs: ${logDir}`);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(`\n✗ ${mask(e instanceof Error ? e.message : String(e))}`);
    results.push({
      id: "--",
      name: "local CI runner",
      status: "fail",
      seconds: 0,
      note: mask(String(e)),
    });
  })
  .finally(async () => {
    await dropDbs();
    process.exitCode = summary();
  });
