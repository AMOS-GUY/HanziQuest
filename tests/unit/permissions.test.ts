import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  hasPermission,
  PERMISSIONS,
  permissionsForRoles,
  ROLE_PERMISSIONS,
} from "@/lib/permissions/permissions";

describe("role permissions", () => {
  it("gives learners no admin capability", () => {
    expect(permissionsForRoles(["LEARNER"]).size).toBe(0);
    for (const permission of PERMISSIONS) {
      expect(hasPermission(["LEARNER"], permission)).toBe(false);
    }
  });

  it("gives super admins every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(["SUPER_ADMIN"], permission)).toBe(true);
    }
  });

  it("lets curriculum editors publish but not manage users or roles", () => {
    expect(hasPermission(["CURRICULUM_EDITOR"], "curriculum:publish")).toBe(true);
    expect(hasPermission(["CURRICULUM_EDITOR"], "users:read")).toBe(false);
    expect(hasPermission(["CURRICULUM_EDITOR"], "users:manage-roles")).toBe(false);
  });

  it("only lets super admins manage roles", () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, perms]) => perms.includes("users:manage-roles"))
      .map(([role]) => role);
    expect(holders).toEqual(["SUPER_ADMIN"]);
  });

  it("keeps analysts and support read-only", () => {
    for (const role of ["ANALYST", "SUPPORT"] as const) {
      for (const permission of [
        "curriculum:write",
        "curriculum:publish",
        "users:moderate",
        "users:manage-roles",
      ] as const) {
        expect(hasPermission([role], permission)).toBe(false);
      }
    }
  });

  it("combines permissions across roles", () => {
    const perms = permissionsForRoles(["ANALYST", "SUPPORT"]);
    expect(perms.has("analytics:read")).toBe(true);
    expect(perms.has("users:read")).toBe(true);
  });

  it("grants admin:access to every admin role", () => {
    for (const role of ADMIN_ROLES) expect(hasPermission([role], "admin:access")).toBe(true);
  });
});
