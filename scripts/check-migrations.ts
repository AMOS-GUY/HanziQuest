/**
 * Migration safety check (M9). Fails when a migration:
 *  - destroys data or breaks the running version during a rollout (DROP TABLE/COLUMN,
 *    TRUNCATE, DELETE, column type changes, renames, NOT NULL without a default), unless the
 *    migration explicitly allows that rule with a reason:
 *        -- migration-safety: allow drop-column Column unused since release 2026-12 (D-0xx)
 *  - was edited after being committed to the base branch (`--base origin/main`): applied
 *    migrations must never change.
 *
 *   npm run db:check-migrations                 # rules only
 *   npm run db:check-migrations -- --base origin/main
 *
 * Production deploys run `prisma migrate deploy`, which never resets or drops on its own; this
 * check makes sure no migration we ship does it either without a deliberate, reviewed decision.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve("prisma/migrations");

export interface MigrationFinding {
  migration: string;
  rule: string;
  line: number;
  text: string;
}

const RULES: { id: string; pattern: RegExp; why: string }[] = [
  { id: "drop-table", pattern: /\bDROP\s+TABLE\b/i, why: "deletes a table and its data" },
  { id: "drop-column", pattern: /\bDROP\s+COLUMN\b/i, why: "deletes a column and its data" },
  { id: "truncate", pattern: /\bTRUNCATE\b/i, why: "deletes all rows" },
  { id: "delete", pattern: /\bDELETE\s+FROM\b/i, why: "deletes rows" },
  {
    id: "alter-type",
    pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i,
    why: "rewrites a column; can lose data or lock the table",
  },
  {
    id: "rename",
    pattern: /\bRENAME\s+(COLUMN|TO)\b/i,
    why: "breaks the running app version during the rollout",
  },
  {
    id: "set-not-null",
    pattern: /\bSET\s+NOT\s+NULL\b/i,
    why: "fails on existing NULLs and breaks older app versions",
  },
  { id: "drop-enum-value", pattern: /\bDROP\s+TYPE\b/i, why: "drops an enum type" },
];

export function checkMigrationSql(migration: string, sql: string): MigrationFinding[] {
  const allowed = new Set(
    [...sql.matchAll(/--[ \t]*migration-safety:[ \t]*allow[ \t]+([\w-]+)[ \t]+\S+/gi)].map((m) =>
      m[1]!.toLowerCase(),
    ),
  );
  const findings: MigrationFinding[] = [];
  sql.split(/\r?\n/).forEach((text, i) => {
    const code = text.replace(/--.*$/, "");
    for (const rule of RULES) {
      if (rule.pattern.test(code) && !allowed.has(rule.id)) {
        findings.push({ migration, rule: rule.id, line: i + 1, text: text.trim() });
      }
    }
  });
  return findings;
}

function changedSince(base: string): string[] {
  const out = execFileSync(
    "git",
    ["diff", "--name-status", `${base}...HEAD`, "--", "prisma/migrations"],
    { encoding: "utf8" },
  );
  return out
    .split(/\r?\n/)
    .filter((l) => /^(M|D|R)/.test(l))
    .map((l) => l.split(/\s+/).slice(1).join(" "));
}

function main() {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
  const migrations = fs
    .readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  let failed = false;
  for (const name of migrations) {
    const file = path.join(DIR, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    for (const f of checkMigrationSql(name, fs.readFileSync(file, "utf8"))) {
      const rule = RULES.find((r) => r.id === f.rule)!;
      console.error(`UNSAFE ${f.migration}:${f.line} [${f.rule}] ${rule.why}\n    ${f.text}`);
      failed = true;
    }
  }
  if (base) {
    for (const file of changedSince(base)) {
      console.error(`EDITED ${file}: migrations already on ${base} must never change`);
      failed = true;
    }
  }
  if (failed) {
    console.error(
      "\nAdd `-- migration-safety: allow <rule> <reason>` only after a reviewed decision (DECISIONS.md).",
    );
    process.exit(1);
  }
  console.log(
    `${migrations.length} migrations checked: no destructive or rollout-breaking statements${base ? `, none edited since ${base}` : ""}.`,
  );
}

if (process.argv[1]?.endsWith("check-migrations.ts")) main();
