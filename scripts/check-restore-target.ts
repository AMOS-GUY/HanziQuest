/**
 * Refuses a restore-verification target that isn't a separate, disposable, local database
 * (backup.yml). Prints no URL or credential.
 *   npm run db:check-restore-target -- --source <backup source url> --target <restore url>
 */
import { arg } from "./lib/db-tools";
import { restoreTargetProblems } from "./lib/restore-target";

const source = arg("source");
const target = arg("target");
if (!source || !target) {
  console.error("Usage: --source <backup source url> --target <restore target url>");
  process.exit(2);
}
try {
  const problems = restoreTargetProblems(source, target, process.env.DATABASE_URL);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("✓ Restore target is a separate, disposable, local database.");
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
