/**
 * Recomputes mastery and review schedules from per-character attempt history.
 * Safe to run at any time: it derives state, never deletes attempts, and grants no XP.
 *   npm run progress:rebuild            # every learner
 *   npm run progress:rebuild -- <userId>
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/database/client";
import { lockLearner, recomputeCharacter } from "../src/features/progress/record";

const prisma = createPrismaClient();

async function main() {
  const userId = process.argv[2];
  const pairs = await prisma.attemptCharacterResult.groupBy({
    by: ["userId", "characterId"],
    where: userId ? { userId } : {},
  });
  for (const p of pairs) {
    await prisma.$transaction(async (tx) => {
      await lockLearner(tx, p.userId);
      await recomputeCharacter(tx, p.userId, p.characterId);
    });
  }
  console.log(`Recomputed ${pairs.length} learner/character pair(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
