/**
 * Helpers for the disposable-database drills (M11). Every database a drill creates is named
 * `hq_drill_<run>_<name>` and dropped at the end, also on failure. The drills refuse to run
 * against anything but a local server (localhost, 127.0.0.1 or ::1), so they can never touch a
 * hosted database. Connection strings are never printed.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const base = process.env.DRILL_DATABASE_URL || process.env.DATABASE_URL;
if (!base) throw new Error("Set DRILL_DATABASE_URL or DATABASE_URL (a local PostgreSQL server)");
const parsed = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname))
  throw new Error("Drills only run against a local PostgreSQL server. Refusing.");

const run = randomBytes(3).toString("hex");
const created: string[] = [];
let failures = 0;

export function urlFor(name: string) {
  const u = new URL(base!);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: urlFor("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function createDb(name: string) {
  const db = `hq_drill_${run}_${name}`;
  await admin((c) => c.query(`CREATE DATABASE "${db}"`));
  created.push(db);
  return urlFor(db);
}

export async function dropAll() {
  for (const db of created.splice(0))
    await admin((c) => c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`)).catch(
      () => undefined,
    );
}

/** Runs a CLI with the given database. Returns {ok, output}; output has URLs masked. */
export function cli(command: string[], env: Record<string, string>) {
  try {
    const out = execFileSync(process.execPath, command, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: mask(out) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: mask(`${err.stdout ?? ""}${err.stderr ?? ""}`) };
  }
}

export const PRISMA = "node_modules/prisma/build/index.js";
export const TSX = "node_modules/tsx/dist/cli.mjs";

function mask(text: string) {
  return text.replace(/postgres(ql)?:\/\/\S+/g, "postgresql://[masked]");
}

export function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

export async function finish(label: string) {
  await dropAll();
  console.log(failures ? `${label}: ${failures} check(s) failed.` : `${label}: all checks passed.`);
  process.exitCode = failures ? 1 : 0;
}
