/**
 * Restore-verification target guard (backup.yml, DATABASE_BACKUP.md). A verification restore
 * must go into a separate, disposable database on the local machine or runner, never into the
 * database the backup came from, and never into the app's DATABASE_URL. Returns problems as
 * text without echoing any URL or credential.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Disposable verification databases are named explicitly. */
export const RESTORE_VERIFY_DB = /^hq_restore_verify(_[a-z0-9_]+)?$/;

interface Parsed {
  host: string;
  port: string;
  db: string;
}

function parse(url: string, label: string): Parsed {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${label} is not a valid database URL.`);
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error(`${label} is not a PostgreSQL URL.`);
  return {
    host: u.hostname.toLowerCase(),
    port: u.port || "5432",
    db: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

const same = (a: Parsed, b: Parsed) => a.host === b.host && a.port === b.port && a.db === b.db;

export function restoreTargetProblems(
  source: string,
  target: string,
  appDatabaseUrl?: string,
): string[] {
  const s = parse(source, "The backup source");
  const t = parse(target, "The restore target");
  const problems: string[] = [];
  if (same(s, t)) problems.push("The restore target is the backup source database.");
  if (!LOCAL_HOSTS.has(t.host))
    problems.push("The restore target must be a local database (localhost), not a hosted one.");
  if (!RESTORE_VERIFY_DB.test(t.db))
    problems.push(
      'The restore target database must be a disposable one named "hq_restore_verify" (optionally with a suffix).',
    );
  if (appDatabaseUrl && same(parse(appDatabaseUrl, "DATABASE_URL"), t))
    problems.push("The restore target is the app's DATABASE_URL.");
  return problems;
}
