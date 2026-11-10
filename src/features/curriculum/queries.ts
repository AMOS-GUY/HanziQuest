import "server-only";
import { prisma } from "@/lib/database/prisma";

/** Published learning path: curricula → levels → units → published lessons (learner-facing). */
export async function getLearningPath() {
  return prisma.curriculum.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      verification: true,
      levels: {
        orderBy: { level: "asc" },
        select: {
          id: true,
          level: true,
          name: true,
          units: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              slug: true,
              title: true,
              description: true,
              lessons: {
                where: { status: "PUBLISHED" },
                orderBy: { position: "asc" },
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  _count: { select: { vocabulary: true, exercises: true } },
                  characters: {
                    where: { isNew: true },
                    orderBy: { position: "asc" },
                    select: { character: { select: { hanzi: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export type LearningPath = Awaited<ReturnType<typeof getLearningPath>>;
