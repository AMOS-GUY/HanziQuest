/**
 * Who is measured (M15). A learner counts when the account:
 * - is ACTIVE: deleted accounts are gone (their learning data is deleted with them), and
 *   suspended accounts are left out;
 * - holds no staff role: any role other than LEARNER excludes the account, whatever else it does;
 * - isn't a test account (`@hanziquest.test`, used by the automated tests).
 */
import type { Prisma } from "@/generated/prisma/client";

export const TEST_ACCOUNT_DOMAIN = "@hanziquest.test";

export const MEASURED_LEARNER: Prisma.UserWhereInput = {
  status: "ACTIVE",
  NOT: { email: { endsWith: TEST_ACCOUNT_DOMAIN, mode: "insensitive" } },
  roles: { none: { role: { key: { not: "LEARNER" } } } },
};
