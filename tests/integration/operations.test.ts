/** M9: operations status and retention. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { operationsStatus } from "@/features/operations/status";
import { pruneOperationalData } from "@/features/operations/retention";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
let userId: string;
let deviceId: string;

beforeAll(async () => {
  await ensureRoles(prisma);
  const r = await registerUser(prisma, {
    displayName: "Ops",
    email: uniqueEmail("ops"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  userId = r.userId;
  deviceId = (await prisma.device.create({ data: { userId, clientId: randomUUID() } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("operations status", () => {
  it("reports migrations, stuck sync events and configuration without values", async () => {
    const before = await operationsStatus(prisma);
    expect(before.migrations.applied).toBeGreaterThanOrEqual(10);
    expect(before.migrations.incomplete).toBe(0);
    expect(before.database.latencyMs).toBeGreaterThanOrEqual(0);

    const old = new Date(Date.now() - 60 * 60_000);
    await prisma.syncEvent.create({
      data: {
        id: randomUUID(),
        userId,
        deviceId,
        type: "attempt",
        payload: {},
        clientCreatedAt: old,
        receivedAt: old,
      },
    });
    const after = await operationsStatus(prisma);
    expect(after.sync.stuck).toBe(before.sync.stuck + 1);
    // Configuration issues carry names and problems only.
    for (const issue of after.configuration) {
      expect(Object.keys(issue).sort()).toEqual(["fatal", "name", "problem"]);
    }
    expect(JSON.stringify(after)).not.toContain(process.env.TEST_DATABASE_URL!);
  });
});

describe("retention", () => {
  it("only reports in a dry run, refuses too-short periods, and audits an applied prune", async () => {
    const now = new Date();
    const ancient = new Date(now.getTime() - 400 * 86_400_000);
    const marker = `ops-test-${randomUUID()}`;
    await prisma.auditLog.create({
      data: { actorId: null, action: marker, entityType: "Test", createdAt: ancient },
    });
    await prisma.syncEvent.create({
      data: {
        id: randomUUID(),
        userId,
        deviceId,
        type: "attempt",
        payload: {},
        status: "PROCESSED",
        clientCreatedAt: ancient,
        receivedAt: ancient,
      },
    });

    await expect(pruneOperationalData(prisma, { auditDays: 5, apply: false })).rejects.toThrow();

    const dry = await pruneOperationalData(prisma, { auditDays: 365, syncDays: 90, apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.counts.auditLog).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { action: marker } })).toBe(1);

    // Without a period, audit entries are never touched.
    const noPeriod = await pruneOperationalData(prisma, { apply: true });
    expect(noPeriod.counts.auditLog).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: marker } })).toBe(1);

    const applied = await pruneOperationalData(prisma, {
      auditDays: 365,
      syncDays: 90,
      apply: true,
    });
    expect(applied.applied).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: marker } })).toBe(0);
    expect(
      await prisma.syncEvent.count({ where: { userId, status: "PROCESSED", receivedAt: ancient } }),
    ).toBe(0);
    // Rejected or unprocessed events are kept for investigation.
    expect(await prisma.syncEvent.count({ where: { userId, status: "RECEIVED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "ops.prune" } })).toBeGreaterThan(0);
  });
});
