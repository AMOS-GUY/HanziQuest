import type { RoleKey } from "@/generated/prisma/enums";

/** Every protected capability in the application. Checked server-side only. */
export const PERMISSIONS = [
  "admin:access",
  "curriculum:read",
  "curriculum:write",
  "curriculum:publish",
  /** Record review decisions and change verification (REVIEWED/VERIFIED). M14-b, D-071. */
  "curriculum:review",
  "content:import",
  "handwriting:validate",
  /** Erase a pilot participant's handwriting data (withdrawal or end of retention). */
  "handwriting:erase",
  "feedback:manage",
  "invites:manage",
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
    "feedback:manage",
  ],
  MODERATOR: ["admin:access", "curriculum:read", "users:read", "users:moderate", "feedback:manage"],
  ANALYST: ["admin:access", "curriculum:read", "analytics:read"],
  SUPPORT: ["admin:access", "users:read", "feedback:manage"],
  // Least privilege: can read curriculum and record reviews, but never edit, publish or import.
  CONTENT_REVIEWER: ["admin:access", "curriculum:read", "curriculum:review"],
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
  CONTENT_REVIEWER: {
    name: "Content reviewer",
    description: "Reviews curriculum content and records review decisions. Can't edit content.",
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
  "CONTENT_REVIEWER",
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
