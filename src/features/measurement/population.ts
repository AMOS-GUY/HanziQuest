/**
 * Who is measured (M15). A learner counts when the account:
 * - isn't DELETED (account deletion also deletes the learning data). Suspended accounts are
 *   counted: if suspending someone removed them from a cohort, staff who can suspend and read
 *   analytics could measure, suspend one learner, measure again and read that learner's results
 *   from the difference;
 * - holds no staff role: any role other than LEARNER excludes the account, whatever else it does;
 * - isn't a test account (`@hanziquest.test`, used by the automated tests).
 *
 * Residual risk (documented, D-079): granting or revoking a staff role changes membership the
 * same way. Role changes are rare, restricted to Super Admins and always audited.
 */
import type { Prisma } from "@/generated/prisma/client";

export const TEST_ACCOUNT_DOMAIN = "@hanziquest.test";

export const MEASURED_LEARNER: Prisma.UserWhereInput = {
  status: { not: "DELETED" },
  NOT: { email: { endsWith: TEST_ACCOUNT_DOMAIN, mode: "insensitive" } },
  roles: { none: { role: { key: { not: "LEARNER" } } } },
};
