import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { verifyPassword, verifyPasswordConstantTime } from "@/lib/auth/password";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();

beforeAll(async () => {
  await ensureRoles(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("registerUser", () => {
  it("creates user, profile, learner role, streak and audit entry atomically", async () => {
    const email = uniqueEmail("reg");
    const result = await registerUser(
      prisma,
      { displayName: "Mei", email: email.toUpperCase(), password: "correct-horse-battery" },
      { ip: "203.0.113.5", userAgent: "vitest" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: { profile: true, roles: { include: { role: true } }, streak: true },
    });
    expect(user.email).toBe(email); // normalised to lowercase
    expect(user.profile?.displayName).toBe("Mei");
    expect(user.roles.map((r) => r.role.key)).toEqual(["LEARNER"]);
    expect(user.streak?.currentLength).toBe(0);
    expect(user.passwordHash).not.toContain("correct-horse");
    expect(await verifyPassword("correct-horse-battery", user.passwordHash!)).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: user.id, action: "user.register" },
    });
    expect(audit?.ipAddress).toBe("203.0.113.5");
  });

  it("rejects a duplicate email regardless of case", async () => {
    const email = uniqueEmail("dup");
    expect(
      (await registerUser(prisma, { displayName: "A", email, password: "password-123" })).ok,
    ).toBe(true);
    const second = await registerUser(prisma, {
      displayName: "B",
      email: email.toUpperCase(),
      password: "password-456",
    });
    expect(second).toEqual({ ok: false, error: "email_taken" });
  });

  it("returns field errors for invalid input and writes nothing", async () => {
    const before = await prisma.user.count();
    const result = await registerUser(prisma, { displayName: "", email: "bad", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === "invalid") {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(["displayName", "email", "password"]);
    }
    expect(await prisma.user.count()).toBe(before);
  });

  it("verifies unknown accounts in constant-ish time without throwing", async () => {
    expect(await verifyPasswordConstantTime("anything", null)).toBe(false);
  });
});
