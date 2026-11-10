/** M9 (D-041): invite-only registration. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { createInvite, revokeInvite } from "@/features/invites/invites";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
let actor: { id: string; roles: ["SUPER_ADMIN"] };

const signUp = (inviteCode: string | undefined, email = uniqueEmail("inv")) =>
  registerUser(
    prisma,
    { displayName: "I", email, password: "password-1234", acceptTerms: true, inviteCode },
    { requireInvite: true },
  );

beforeAll(async () => {
  await ensureRoles(prisma);
  const r = await registerUser(prisma, {
    displayName: "Admin",
    email: uniqueEmail("inv-admin"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  actor = { id: r.userId, roles: ["SUPER_ADMIN"] };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("invite-only registration", () => {
  it("stores only a hash, audits creation and links the account to its invite", async () => {
    const { invite, code } = await createInvite(prisma, actor, { label: "IT", maxUses: "2" });
    expect(code).toMatch(/^HQ-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(JSON.stringify(invite)).not.toContain(code.slice(3, 8));
    expect(
      await prisma.auditLog.count({ where: { action: "invite.create", entityId: invite.id } }),
    ).toBe(1);

    const result = await signUp(code.toLowerCase().replace(/-/g, " "));
    expect(result.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: (result as { userId: string }).userId },
    });
    expect(user.inviteId).toBe(invite.id);
  });

  it("refuses missing, unknown, expired and revoked codes", async () => {
    expect(await signUp(undefined)).toEqual({ ok: false, error: "invite_invalid" });
    expect(await signUp("HQ-00000-00000")).toEqual({ ok: false, error: "invite_invalid" });
    expect(await signUp("not a code")).toEqual({ ok: false, error: "invite_invalid" });

    const past = new Date(Date.now() - 40 * 86_400_000);
    const expired = await createInvite(prisma, actor, { label: "old", expiresInDays: "30" }, past);
    expect(await signUp(expired.code)).toEqual({ ok: false, error: "invite_invalid" });

    const revoked = await createInvite(prisma, actor, { label: "revoked" });
    await revokeInvite(prisma, actor, revoked.invite.id);
    expect(await signUp(revoked.code)).toEqual({ ok: false, error: "invite_invalid" });
  });

  it("never exceeds maxUses, even with concurrent sign-ups", async () => {
    const { invite, code } = await createInvite(prisma, actor, { label: "race", maxUses: "2" });
    const results = await Promise.all(Array.from({ length: 5 }, () => signUp(code)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toHaveLength(3);
    const row = await prisma.betaInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.uses).toBe(2);
    expect(await prisma.user.count({ where: { inviteId: invite.id } })).toBe(2);
  });

  it("does not use up the invite when the sign-up fails for another reason", async () => {
    const { invite, code } = await createInvite(prisma, actor, { label: "dup" });
    const email = uniqueEmail("taken");
    await registerUser(prisma, { displayName: "X", email, password: "password-1234" });
    expect(await signUp(code, email)).toEqual({ ok: false, error: "email_taken" });
    expect((await prisma.betaInvite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(0);
    expect((await signUp(code)).ok).toBe(true);
  });

  it("validates invite input", async () => {
    await expect(createInvite(prisma, actor, { label: "x" })).rejects.toThrow();
    await expect(createInvite(prisma, actor, { label: "ok", maxUses: "0" })).rejects.toThrow();
    await expect(
      createInvite(prisma, actor, { label: "ok", expiresInDays: "999" }),
    ).rejects.toThrow();
  });
});
