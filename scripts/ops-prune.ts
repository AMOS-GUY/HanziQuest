/**
 * Retention for operational data. Dry run unless --apply is given.
 *   npm run ops:prune -- --audit-days 365 --sync-days 90            # show what would go
 *   npm run ops:prune -- --audit-days 365 --sync-days 90 --apply    # delete it
 * Choose the periods with the owner (docs/LEGAL_REVIEW.md) and record them in DEPLOYMENT.md.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/database/client";
import { pruneOperationalData } from "../src/features/operations/retention";

function numberArg(name: string) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = Number(process.argv[i + 1]);
  if (!Number.isInteger(value)) throw new Error(`${name} needs a whole number of days`);
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = createPrismaClient();
  try {
    const result = await pruneOperationalData(prisma, {
      auditDays: numberArg("--audit-days"),
      syncDays: numberArg("--sync-days"),
      apply,
    });
    console.log(
      `${result.applied ? "Deleted" : "Would delete (dry run; add --apply)"}: ` +
        `${result.counts.auditLog} audit entries, ${result.counts.syncEvents} processed sync events, ` +
        `${result.counts.rateLimitBuckets} expired rate-limit buckets.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
