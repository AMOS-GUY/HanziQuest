/**
 * Local vs hosted databases (M11). Default development and test commands may only touch a
 * database on this machine. Hosted (staging, production) databases are reached only through the
 * explicit `staging:*` scripts, the protected deploy and backup workflows, or a command the owner
 * runs deliberately with an explicit target.
 */
export const LOCAL_DATABASE_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

/** True for postgres URLs on this machine. Unparseable or missing URLs are NOT local. */
export function isLocalDatabaseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_DATABASE_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Host and database only, for messages. Never credentials. */
export function describeDatabaseUrl(url: string | null | undefined): string {
  if (!url) return "(not set)";
  try {
    const u = new URL(url);
    return `${u.hostname.split(".")[0]}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable)";
  }
}
