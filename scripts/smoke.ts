/**
 * Post-deployment smoke test. Read-only: it never signs in or writes data.
 *   npm run smoke -- https://your-domain.example
 * Exits with status 1 if any check fails.
 */
const base = (process.argv[2] ?? process.env.SMOKE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

interface Check {
  name: string;
  run: () => Promise<string | void>;
}

async function get(path: string, init?: RequestInit) {
  return fetch(`${base}${path}`, { redirect: "manual", ...init });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const checks: Check[] = [
  {
    name: "liveness endpoint answers",
    run: async () => {
      const r = await get("/api/health/live");
      const body = (await r.json()) as { status: string };
      assert(r.status === 200 && body.status === "ok", `status ${r.status}`);
      return "ok";
    },
  },
  {
    name: "readiness: database ok and every migration applied",
    run: async () => {
      const r = await get("/api/health");
      const body = (await r.json()) as {
        status: string;
        database: string;
        migrations: string;
        release: string;
      };
      assert(
        r.status === 200 && body.database === "ok" && body.migrations === "ok",
        `status ${r.status}, ${JSON.stringify(body)}`,
      );
      return `release ${body.release}`;
    },
  },
  {
    name: "welcome page renders",
    run: async () => {
      const r = await get("/");
      assert(r.status === 200, `status ${r.status}`);
      assert((await r.text()).includes("HanziQuest"), "brand name missing");
    },
  },
  {
    name: "security headers are present",
    run: async () => {
      const r = await get("/login");
      for (const h of [
        "content-security-policy",
        "strict-transport-security",
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
      ])
        assert(r.headers.get(h), `missing ${h}`);
      assert(!r.headers.get("x-powered-by"), "x-powered-by is exposed");
    },
  },
  {
    name: "web app manifest is installable",
    run: async () => {
      const r = await get("/manifest.webmanifest");
      const m = (await r.json()) as {
        name?: string;
        start_url?: string;
        display?: string;
        icons?: { src: string; sizes: string }[];
      };
      assert(m.name && m.start_url && m.display === "standalone", "name/start_url/display");
      for (const size of ["192x192", "512x512"]) {
        const icon = m.icons?.find((i) => i.sizes === size);
        assert(icon, `no ${size} icon`);
        const ir = await get(icon.src);
        assert(ir.status === 200, `${icon.src} returned ${ir.status}`);
      }
    },
  },
  {
    name: "service worker is served and never cached long",
    run: async () => {
      const r = await get("/sw.js");
      assert(r.status === 200, `status ${r.status}`);
      assert(/no-cache|max-age=0/.test(r.headers.get("cache-control") ?? ""), "cache-control");
    },
  },
  {
    name: "offline pages are available",
    run: async () => {
      for (const p of ["/offline", "/offline/practice"]) {
        const r = await get(p);
        assert(r.status === 200, `${p} returned ${r.status}`);
      }
    },
  },
  {
    name: "protected pages require sign-in",
    run: async () => {
      for (const p of ["/home", "/admin"]) {
        const r = await get(p);
        assert([302, 303, 307].includes(r.status), `${p} returned ${r.status}`);
        assert((r.headers.get("location") ?? "").includes("/login"), `${p} did not go to login`);
      }
    },
  },
  {
    name: "learning API rejects anonymous and cross-site writes",
    run: async () => {
      const anon = await get("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert(anon.status === 401, `anonymous sync returned ${anon.status}`);
      const cross = await get("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: "{}",
      });
      assert(cross.status === 403, `cross-site write returned ${cross.status}`);
    },
  },
];

async function main() {
  console.log(`Smoke testing ${base}`);
  let failed = 0;
  for (const c of checks) {
    try {
      const note = await c.run();
      console.log(`  ✓ ${c.name}${note ? ` (${note})` : ""}`);
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${c.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failed ? `${failed} check(s) failed.` : "All checks passed.");
  process.exitCode = failed ? 1 : 0;
}

void main();
