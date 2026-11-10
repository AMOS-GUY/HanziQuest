import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import {
  changePassword,
  deleteAccount,
  setUserStatus,
  updateProfile,
} from "@/features/account/account";
import { verifyPassword } from "@/lib/auth/password";
import { createLimit } from "@/lib/security/rate-limit";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();

async function newUser(password = "password-1234") {
  const r = await registerUser(prisma, { displayName: "A", email: uniqueEmail("acct"), password });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

async function grant(userId: string, key: "SUPER_ADMIN" | "MODERATOR" | "SUPPORT") {
  const role = await prisma.role.findUniqueOrThrow({ where: { key } });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
}

beforeAll(async () => {
  await ensureRoles(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("profile and password", () => {
  it("updates goal and time zone, rejecting unknown values", async () => {
    const id = await newUser();
    await updateProfile(prisma, id, {
      displayName: "Renamed",
      dailyGoalXp: "50",
      timezone: "Asia/Tokyo",
    });
    const p = await prisma.profile.findUniqueOrThrow({ where: { userId: id } });
    expect(p).toMatchObject({ displayName: "Renamed", dailyGoalXp: 50, timezone: "Asia/Tokyo" });
    await expect(
      updateProfile(prisma, id, { displayName: "x", dailyGoalXp: "999", timezone: "Mars/Base" }),
    ).rejects.toThrow();
  });

  it("requires the current password and revokes older sessions", async () => {
    const id = await newUser("old-password-1");
    await expect(
      changePassword(prisma, id, {
        currentPassword: "wrong-password",
        newPassword: "new-password-2",
        confirmPassword: "new-password-2",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      changePassword(prisma, id, {
        currentPassword: "old-password-1",
        newPassword: "new-password-2",
        confirmPassword: "different-3",
      }),
    ).rejects.toThrow();
    const before = Date.now();
    await changePassword(prisma, id, {
      currentPassword: "old-password-1",
      newPassword: "new-password-2",
      confirmPassword: "new-password-2",
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(await verifyPassword("new-password-2", user.passwordHash!)).toBe(true);
    expect(user.credentialsChangedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(
      await prisma.auditLog.count({ where: { entityId: id, action: "user.password.change" } }),
    ).toBe(1);
  });
});

describe("account deletion", () => {
  it("deletes the account and its data after the password and DELETE confirmation", async () => {
    const id = await newUser();
    await expect(
      deleteAccount(prisma, id, { password: "password-1234", confirm: "delete" }),
    ).rejects.toThrow();
    await expect(
      deleteAccount(prisma, id, { password: "nope", confirm: "DELETE" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await deleteAccount(prisma, id, { password: "password-1234", confirm: "DELETE" });
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.profile.findUnique({ where: { userId: id } })).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { entityId: id, action: "user.delete.self" } }),
    ).toBe(1);
  });

  it("refuses to delete the last Super Admin", async () => {
    const supers = await prisma.userRole.count({ where: { role: { key: "SUPER_ADMIN" } } });
    const id = await newUser();
    await grant(id, "SUPER_ADMIN");
    if (supers === 0) {
      await expect(
        deleteAccount(prisma, id, { password: "password-1234", confirm: "DELETE" }),
      ).rejects.toMatchObject({ code: "conflict" });
    } else {
      // Another Super Admin exists in this database, so deletion is allowed.
      await deleteAccount(prisma, id, { password: "password-1234", confirm: "DELETE" });
    }
  });
});

describe("moderation", () => {
  it("suspends and reactivates learners with an audit trail", async () => {
    const mod = await newUser();
    await grant(mod, "MODERATOR");
    const learner = await newUser();
    const actor = { id: mod, roles: ["MODERATOR" as const] };
    await setUserStatus(prisma, actor, learner, "SUSPENDED", "spam");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: learner } })).status).toBe(
      "SUSPENDED",
    );
    await setUserStatus(prisma, actor, learner, "ACTIVE", "appeal accepted");
    expect(
      await prisma.auditLog.count({
        where: { entityId: learner, action: { in: ["user.suspend", "user.reactivate"] } },
      }),
    ).toBe(2);
  });

  it("blocks self-moderation and moderating staff without Super Admin", async () => {
    const mod = await newUser();
    await grant(mod, "MODERATOR");
    const staff = await newUser();
    await grant(staff, "SUPPORT");
    const actor = { id: mod, roles: ["MODERATOR" as const] };
    await expect(setUserStatus(prisma, actor, mod, "SUSPENDED", "test")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(setUserStatus(prisma, actor, staff, "SUSPENDED", "test")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("shared rate limit store", () => {
  it("counts across limiter instances through PostgreSQL", async () => {
    const previous = { store: process.env.RATE_LIMIT_STORE, url: process.env.DATABASE_URL };
    process.env.RATE_LIMIT_STORE = "postgres";
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    try {
      const name = `it-${Date.now()}`;
      // Two separate limiter objects stand in for two server instances.
      const a = createLimit(name, 3, 60_000);
      const b = createLimit(`${name}`, 3, 60_000);
      const results = [
        await a.consume("k"),
        await b.consume("k"),
        await a.consume("k"),
        await b.consume("k"),
      ];
      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
      expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
      await a.reset("k");
      expect((await b.consume("k")).allowed).toBe(true);
    } finally {
      process.env.RATE_LIMIT_STORE = previous.store;
      process.env.DATABASE_URL = previous.url;
    }
  });
});
