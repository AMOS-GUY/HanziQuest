import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { RoleKey } from "@/generated/prisma/enums";
import { prisma } from "@/lib/database/prisma";
import { auth } from "@/lib/auth/auth";
import { hasPermission, permissionsForRoles, type Permission } from "@/lib/permissions/permissions";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  roles: RoleKey[];
  permissions: Set<Permission>;
  profile: {
    displayName: string;
    dailyGoalXp: number;
    timezone: string;
    declaredHskLevel: number | null;
    onboardingCompletedAt: Date | null;
  } | null;
}

/**
 * Returns the signed-in, ACTIVE user with roles loaded from the database, or null.
 * Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } }, profile: true },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const roles = user.roles.map((r) => r.role.key);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    permissions: permissionsForRoles(roles),
    profile: user.profile
      ? {
          displayName: user.profile.displayName,
          dailyGoalXp: user.profile.dailyGoalXp,
          timezone: user.profile.timezone,
          declaredHskLevel: user.profile.declaredHskLevel,
          onboardingCompletedAt: user.profile.onboardingCompletedAt,
        }
      : null,
  };
});

/** For pages: redirects to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For admin pages: signed-out users go to /login; signed-in users without the permission get a 404,
 * so the admin area's existence is not confirmed to learners.
 */
export async function requirePagePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user.roles, permission)) notFound();
  return user;
}

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message = status === 401 ? "Authentication required" : "Forbidden",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** For server actions and route handlers: throws AuthorizationError (401/403). */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError(401);
  if (!hasPermission(user.roles, permission)) throw new AuthorizationError(403);
  return user;
}
