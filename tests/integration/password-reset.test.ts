/** Integration audit (D-045): staff-issued, single-use password reset links. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import {
  hashResetToken,
  issuePasswordReset,
  RESET_TTL_HOURS,
  resetPassword,
  resetTokenUsable,
} from "@/features/account/password-reset";
import { verifyPassword } from "@/lib/auth/password";
import { setUserRole } from "@/features/administration/services";
import { setUserStatus } from "@/features/account/account";
import type { RoleKey } from "@/generated/prisma/enums";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const NEW = { newPassword: "a-new-password-42", confirmPassword: "a-new-password-42" };
let superAdmin: { id: string; roles: RoleKey[] };
let moderator: { id: string; roles: RoleKey[] };

async function newUser(role?: RoleKey) {
  const r = await registerUser(prisma, {
    displayName: "R",
    email: uniqueEmail("reset"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  if (role) {
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.userRole.create({ data: { userId: r.userId, roleId: roleRow.id } });
  }
  return r.userId;
}

beforeAll(async () => {
  await ensureRoles(prisma);
  superAdmin = { id: await newUser("SUPER_ADMIN"), roles: ["SUPER_ADMIN"] };
  moderator = { id: await newUser("MODERATOR"), roles: ["MODERATOR"] };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("password reset links", () => {
  it("stores only a hash, works once, signs out other sessions and is audited", async () => {
    const learner = await newUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: learner } });
    const { token, expiresAt } = await issuePasswordReset(prisma, moderator, learner, {
      reason: "asked by message",
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(RESET_TTL_HOURS * 3_600_000);
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: learner } });
    expect(row.tokenHash).toBe(hashResetToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await resetTokenUsable(prisma, token)).toBe(true);

    await resetPassword(prisma, token, NEW, { ip: "203.0.113.9" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: learner } });
    expect(await verifyPassword(NEW.newPassword, after.passwordHash!)).toBe(true);
    expect(await verifyPassword("password-1234", after.passwordHash!)).toBe(false);
    expect(after.credentialsChangedAt!.getTime()).toBeGreaterThan(
      before.credentialsChangedAt?.getTime() ?? 0,
    );
    // Single use.
    expect(await resetTokenUsable(prisma, token)).toBe(false);
    await expect(resetPassword(prisma, token, NEW)).rejects.toMatchObject({ code: "not_found" });
    const actions = await prisma.auditLog.findMany({
      where: { entityId: learner, action: { startsWith: "user.password.reset" } },
      select: { action: true, actorId: true },
    });
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: "user.password.reset_link", actorId: moderator.id },
        { action: "user.password.reset", actorId: learner },
      ]),
    );
    expect(actions).toHaveLength(2);
  });

  it("validates the new password before using the link", async () => {
    const learner = await newUser();
    const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "forgot" });
    await expect(
      resetPassword(prisma, token, { newPassword: "short", confirmPassword: "short" }),
    ).rejects.toThrow();
    await expect(
      resetPassword(prisma, token, { ...NEW, confirmPassword: "something-else-1" }),
    ).rejects.toThrow();
    // A rejected attempt doesn't consume the link.
    expect(await resetTokenUsable(prisma, token)).toBe(true);
  });

  it("keeps one live link per account and refuses expired links", async () => {
    const learner = await newUser();
    const first = await issuePasswordReset(prisma, moderator, learner, { reason: "first" });
    const second = await issuePasswordReset(prisma, moderator, learner, { reason: "second" });
    expect(await resetTokenUsable(prisma, first.token)).toBe(false);
    expect(await resetTokenUsable(prisma, second.token)).toBe(true);
    const later = new Date(Date.now() + (RESET_TTL_HOURS + 1) * 3_600_000);
    expect(await resetTokenUsable(prisma, second.token, later)).toBe(false);
    await expect(resetPassword(prisma, second.token, NEW, {}, later)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("keeps one live link per account under concurrent creation", async () => {
    const learner = await newUser();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        issuePasswordReset(prisma, moderator, learner, { reason: "parallel" }),
      ),
    );
    const usable = await Promise.all(
      results.map((r) =>
        r.status === "fulfilled" ? resetTokenUsable(prisma, r.value.token) : false,
      ),
    );
    expect(usable.filter(Boolean)).toHaveLength(1);
    expect(
      await prisma.passwordResetToken.count({ where: { userId: learner, usedAt: null } }),
    ).toBe(1);
  });

  it("can be used only once under concurrency", async () => {
    const learner = await newUser();
    const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "race" });
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => resetPassword(prisma, token, NEW)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: learner, action: "user.password.reset" } }),
    ).toBe(1);
  });

  it("guards who can issue links and for whom", async () => {
    const staff = await newUser("CURRICULUM_EDITOR");
    await expect(
      issuePasswordReset(prisma, moderator, staff, { reason: "staff" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      issuePasswordReset(prisma, superAdmin, staff, { reason: "staff" }),
    ).resolves.toBeTruthy();
    await expect(
      issuePasswordReset(prisma, moderator, moderator.id, { reason: "self" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(issuePasswordReset(prisma, moderator, staff, { reason: "" })).rejects.toThrow();

    // Suspended accounts: no new links, and existing links stop working.
    const learner = await newUser();
    const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "x-y-z" });
    await prisma.user.update({ where: { id: learner }, data: { status: "SUSPENDED" } });
    expect(await resetTokenUsable(prisma, token)).toBe(false);
    await expect(resetPassword(prisma, token, NEW)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      issuePasswordReset(prisma, moderator, learner, { reason: "again" }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await resetTokenUsable(prisma, "not-a-token")).toBe(false);
  });

  describe("policy is rechecked when the link is used (D-047)", () => {
    async function grantDirectly(userId: string, role: RoleKey) {
      const roleRow = await prisma.role.findUniqueOrThrow({ where: { key: role } });
      await prisma.userRole.create({ data: { userId, roleId: roleRow.id } });
    }

    it("a moderator's link dies when the learner is promoted to staff", async () => {
      const learner = await newUser();
      const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "x-y-z" });
      await setUserRole(prisma, superAdmin, learner, "CURRICULUM_EDITOR", true);
      expect(await resetTokenUsable(prisma, token)).toBe(false);
      expect(await prisma.passwordResetToken.count({ where: { userId: learner } })).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: learner, action: "user.role.grant" },
      });
      expect(audit.after).toMatchObject({ role: "CURRICULUM_EDITOR", discardedResetLinks: 1 });
    });

    it("refuses a moderator's link for an account that became staff by any route", async () => {
      const learner = await newUser();
      const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "x-y-z" });
      // A role written without the admin service (seed, script) still blocks the link.
      await grantDirectly(learner, "SUPPORT");
      expect(await resetTokenUsable(prisma, token)).toBe(false);
      await expect(resetPassword(prisma, token, NEW)).rejects.toMatchObject({ code: "not_found" });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: learner } });
      expect(await verifyPassword("password-1234", user.passwordHash!)).toBe(true);
    });

    it("a Super Admin's link still works after a promotion by another route", async () => {
      const learner = await newUser();
      const { token } = await issuePasswordReset(prisma, superAdmin, learner, { reason: "x-y-z" });
      await grantDirectly(learner, "SUPPORT");
      expect(await resetTokenUsable(prisma, token)).toBe(true);
      await expect(resetPassword(prisma, token, NEW)).resolves.toBeTruthy();
    });

    it("links die when the issuer is suspended or stops being a moderator", async () => {
      const issuer = await newUser("MODERATOR");
      const issuerActor = { id: issuer, roles: ["MODERATOR"] as RoleKey[] };
      const a = await issuePasswordReset(prisma, issuerActor, await newUser(), { reason: "a-a" });
      const b = await issuePasswordReset(prisma, issuerActor, await newUser(), { reason: "b-b" });
      expect(await resetTokenUsable(prisma, a.token)).toBe(true);

      await setUserRole(prisma, superAdmin, issuer, "MODERATOR", false);
      expect(await resetTokenUsable(prisma, a.token)).toBe(false);
      await expect(resetPassword(prisma, a.token, NEW)).rejects.toMatchObject({
        code: "not_found",
      });

      await setUserRole(prisma, superAdmin, issuer, "MODERATOR", true);
      expect(await resetTokenUsable(prisma, b.token)).toBe(true);
      await setUserStatus(prisma, superAdmin, issuer, "SUSPENDED", "e2e check");
      expect(await resetTokenUsable(prisma, b.token)).toBe(false);
    });

    it("suspending an account discards its links, so reactivating doesn't revive them", async () => {
      const learner = await newUser();
      const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "x-y-z" });
      await setUserStatus(prisma, moderator, learner, "SUSPENDED", "spam");
      await setUserStatus(prisma, moderator, learner, "ACTIVE", "appeal");
      expect(await resetTokenUsable(prisma, token)).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: learner, action: "user.suspend" },
      });
      expect(audit.after).toMatchObject({ status: "SUSPENDED", discardedResetLinks: 1 });
    });
  });

  it("is refused everywhere while the switch is off", async () => {
    const learner = await newUser();
    const { token } = await issuePasswordReset(prisma, moderator, learner, { reason: "x-y-z" });
    const previous = process.env.PASSWORD_RESET_LINKS;
    process.env.PASSWORD_RESET_LINKS = "off";
    try {
      await expect(
        issuePasswordReset(prisma, moderator, learner, { reason: "x-y-z" }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await resetTokenUsable(prisma, token)).toBe(false);
      await expect(resetPassword(prisma, token, NEW)).rejects.toMatchObject({ code: "not_found" });
    } finally {
      if (previous === undefined) delete process.env.PASSWORD_RESET_LINKS;
      else process.env.PASSWORD_RESET_LINKS = previous;
    }
    // Turning it back on doesn't lose the unused link.
    expect(await resetTokenUsable(prisma, token)).toBe(true);
  });
});
