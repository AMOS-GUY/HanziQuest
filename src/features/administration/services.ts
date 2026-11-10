import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RoleKey } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";

export interface Actor {
  id: string;
  roles: readonly RoleKey[];
  ip?: string | null;
  userAgent?: string | null;
}

export class DomainError extends Error {
  constructor(
    public readonly code: "not_found" | "conflict" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

async function nextRevision(tx: Prisma.TransactionClient, entityType: string, entityId: string) {
  const last = await tx.contentRevision.findFirst({
    where: { entityType, entityId },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return (last?.revision ?? 0) + 1;
}

/**
 * Publishes or unpublishes a lesson. Snapshots the previous state as a ContentRevision and
 * writes an audit entry in the same transaction. Authorization is enforced by the caller.
 */
export async function setLessonStatus(
  prisma: PrismaClient,
  actor: Actor,
  lessonId: string,
  status: "PUBLISHED" | "DRAFT",
) {
  return prisma.$transaction(async (tx) => {
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new DomainError("not_found", "Lesson not found");
    if (lesson.status === status) return lesson;

    await tx.contentRevision.create({
      data: {
        entityType: "Lesson",
        entityId: lesson.id,
        revision: await nextRevision(tx, "Lesson", lesson.id),
        data: {
          title: lesson.title,
          status: lesson.status,
          contentVersion: lesson.contentVersion,
          publishedAt: lesson.publishedAt?.toISOString() ?? null,
        },
        authorId: actor.id,
      },
    });
    const updated = await tx.lesson.update({
      where: { id: lesson.id },
      data: { status, publishedAt: status === "PUBLISHED" ? new Date() : lesson.publishedAt },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: status === "PUBLISHED" ? "lesson.publish" : "lesson.unpublish",
      entityType: "Lesson",
      entityId: lesson.id,
      before: { status: lesson.status },
      after: { status },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  });
}

/**
 * Grants or revokes a role. Guards:
 *  - LEARNER cannot be removed (every account keeps it);
 *  - only SUPER_ADMINs may grant or revoke SUPER_ADMIN;
 *  - an admin cannot revoke their own SUPER_ADMIN, and the last SUPER_ADMIN cannot be removed.
 */
export async function setUserRole(
  prisma: PrismaClient,
  actor: Actor,
  userId: string,
  roleKey: RoleKey,
  grant: boolean,
) {
  if (roleKey === "LEARNER" && !grant) {
    throw new DomainError("conflict", "The Learner role cannot be removed");
  }
  if (roleKey === "SUPER_ADMIN" && !actor.roles.includes("SUPER_ADMIN")) {
    throw new DomainError("forbidden", "Only a Super Admin can change the Super Admin role");
  }
  if (roleKey === "SUPER_ADMIN" && !grant && userId === actor.id) {
    throw new DomainError("conflict", "You cannot remove your own Super Admin role");
  }

  return prisma.$transaction(async (tx) => {
    const [user, role] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
      tx.role.findUnique({ where: { key: roleKey } }),
    ]);
    if (!user || !role) throw new DomainError("not_found", "User or role not found");

    const existing = await tx.userRole.findUnique({
      where: { userId_roleId: { userId, roleId: role.id } },
    });
    if (grant === Boolean(existing)) return { changed: false };

    if (grant) {
      await tx.userRole.create({ data: { userId, roleId: role.id, assignedById: actor.id } });
    } else {
      if (roleKey === "SUPER_ADMIN") {
        const superAdmins = await tx.userRole.count({ where: { roleId: role.id } });
        if (superAdmins <= 1)
          throw new DomainError("conflict", "At least one Super Admin must remain");
      }
      await tx.userRole.delete({ where: { userId_roleId: { userId, roleId: role.id } } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: grant ? "user.role.grant" : "user.role.revoke",
      entityType: "User",
      entityId: userId,
      after: { role: roleKey },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return { changed: true };
  });
}
