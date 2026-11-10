import type { RoleKey } from "@/generated/prisma/enums";

/** Every protected capability in the application. Checked server-side only. */
export const PERMISSIONS = [
  "admin:access",
  "curriculum:read",
  "curriculum:write",
  "curriculum:publish",
  "content:import",
  "handwriting:validate",
  "users:read",
  "users:moderate",
  "users:manage-roles",
  "analytics:read",
  "audit:read",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  CURRICULUM_EDITOR: [
    "admin:access",
    "curriculum:read",
    "curriculum:write",
    "curriculum:publish",
    "content:import",
    "handwriting:validate",
  ],
  MODERATOR: ["admin:access", "curriculum:read", "users:read", "users:moderate"],
  ANALYST: ["admin:access", "curriculum:read", "analytics:read"],
  SUPPORT: ["admin:access", "users:read"],
  LEARNER: [],
};

export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string }> = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Full access, including role assignment and settings.",
  },
  CURRICULUM_EDITOR: {
    name: "Curriculum Editor",
    description: "Creates, edits, imports and publishes curriculum content.",
  },
  MODERATOR: {
    name: "Moderator",
    description: "Views learners and can suspend or reactivate accounts.",
  },
  ANALYST: { name: "Analyst", description: "Views aggregate learning analytics." },
  SUPPORT: {
    name: "Support",
    description: "Views learner account details to help with support requests.",
  },
  LEARNER: { name: "Learner", description: "Default role for every registered account." },
};

/** Roles that grant any admin capability. */
export const ADMIN_ROLES: RoleKey[] = [
  "SUPER_ADMIN",
  "CURRICULUM_EDITOR",
  "MODERATOR",
  "ANALYST",
  "SUPPORT",
];

export function permissionsForRoles(roles: readonly RoleKey[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) result.add(permission);
  }
  return result;
}

export function hasPermission(roles: readonly RoleKey[], permission: Permission): boolean {
  return permissionsForRoles(roles).has(permission);
}
