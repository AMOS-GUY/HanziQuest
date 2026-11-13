import { describe, expect, it } from "vitest";
import {
  reviewerRoleOf,
  reviewStatus,
  sourceBlockers,
  summariseQueue,
  type QueueItem,
} from "@/features/curriculum/review";
import { canonicalJson, versionOf } from "@/features/curriculum/review-fingerprint";
import { parseSourceRegister, sourceRegister } from "@/features/curriculum/sources";

const pending = sourceRegister();
const approved = parseSourceRegister({
  sources: pending.sources.map((s) => ({
    ...s,
    approval: { status: "APPROVED", approverRole: "SUPER_ADMIN", approvedOn: "2026-11-13" },
  })),
});

const row = (
  decision: "APPROVED" | "CHANGES_REQUESTED",
  fingerprint: string,
  level: "REVIEWED" | null = "REVIEWED",
) => ({
  id: fingerprint + decision,
  entityType: "CHARACTER" as const,
  entityId: "c",
  fingerprint,
  decision,
  level: decision === "APPROVED" ? level : null,
  reviewerRole: "CONTENT_REVIEWER",
  reviewerId: "r1",
  note: null,
  createdAt: new Date(),
  snapshot: {},
});

describe("content versions (fingerprints)", () => {
  it("are stable regardless of key order and change with any reviewed value", () => {
    const a = versionOf({ kind: "CHARACTER", hanzi: "你", meaning: "you", sourceRefs: ["x"] });
    const b = versionOf({ sourceRefs: ["x"], meaning: "you", hanzi: "你", kind: "CHARACTER" });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(
      versionOf({ kind: "CHARACTER", hanzi: "你", meaning: "you (sg.)", sourceRefs: ["x"] })
        .fingerprint,
    ).not.toBe(a.fingerprint);
    expect(
      versionOf({ kind: "CHARACTER", hanzi: "你", meaning: "you", sourceRefs: ["y"] }).fingerprint,
    ).not.toBe(a.fingerprint);
  });

  it("canonical JSON sorts nested keys and normalises undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2,"d":null},"b":1}');
  });
});

describe("review status", () => {
  it("is approved only for the exact approved version", () => {
    expect(reviewStatus("REVIEWED", "v1:a", [row("APPROVED", "v1:a")])).toBe("approved");
    expect(reviewStatus("REVIEWED", "v1:b", [row("APPROVED", "v1:a")])).toBe("stale");
    expect(reviewStatus("PROVISIONAL", "v1:b", [row("APPROVED", "v1:a")])).toBe("stale");
  });

  it("tracks requested changes per version, and needs review again after a change", () => {
    expect(reviewStatus("PROVISIONAL", "v1:a", [row("CHANGES_REQUESTED", "v1:a")])).toBe(
      "changes-requested",
    );
    expect(reviewStatus("PROVISIONAL", "v1:b", [row("CHANGES_REQUESTED", "v1:a")])).toBe(
      "needs-review",
    );
    expect(reviewStatus("PROVISIONAL", "v1:a", [])).toBe("needs-review");
  });

  it("flags a status that has no review record (set before M14-b or declared by an import)", () => {
    expect(reviewStatus("VERIFIED", "v1:a", [])).toBe("unreviewed-status");
  });

  it("is approved only at the approved level: a higher declared status isn't covered", () => {
    expect(reviewStatus("VERIFIED", "v1:a", [row("APPROVED", "v1:a", "REVIEWED")])).toBe(
      "unreviewed-status",
    );
  });

  it("is stale when the sources no longer support the approved level", () => {
    expect(reviewStatus("REVIEWED", "v1:a", [row("APPROVED", "v1:a")], false)).toBe("stale");
    // A provisional item isn't affected.
    expect(reviewStatus("PROVISIONAL", "v1:a", [], false)).toBe("needs-review");
  });
});

describe("source blockers (same rules as imports)", () => {
  const item = { sourceRefs: ["hanziquest-authored"], licenseStatus: "ORIGINAL" };

  it("blocks approval while a source awaits the owner, and passes once approved", () => {
    expect(sourceBlockers(item, "REVIEWED", "CHARACTER", pending).map((b) => b.code)).toContain(
      "source-not-approved",
    );
    expect(sourceBlockers(item, "REVIEWED", "CHARACTER", approved)).toEqual([]);
  });

  it("blocks missing, unregistered and unsuitable sources", () => {
    expect(
      sourceBlockers({ ...item, sourceRefs: [] }, "REVIEWED", "CHARACTER", approved)[0]!.code,
    ).toBe("no-source");
    expect(
      sourceBlockers({ ...item, sourceRefs: ["nope"] }, "REVIEWED", "CHARACTER", approved).map(
        (b) => b.code,
      ),
    ).toContain("unregistered-source");
    // Stroke data alone can't back a reading or a gloss.
    expect(
      sourceBlockers(
        { ...item, sourceRefs: ["hanzi-writer-data-2.0.1"] },
        "REVIEWED",
        "CHARACTER",
        approved,
      )
        .map((b) => b.message)
        .join(" "),
    ).toMatch(/readings or glosses/);
  });

  it("VERIFIED also needs known licences; examples need an example source", () => {
    expect(
      sourceBlockers({ ...item, licenseStatus: "UNKNOWN" }, "VERIFIED", "CHARACTER", approved).map(
        (b) => b.code,
      ),
    ).toContain("licence-unknown");
    expect(
      sourceBlockers(
        { ...item, example: { sourceRef: null } },
        "REVIEWED",
        "VOCABULARY",
        approved,
      ).map((b) => b.code),
    ).toContain("no-source");
    expect(
      sourceBlockers(
        { ...item, example: { sourceRef: "hanziquest-authored" } },
        "REVIEWED",
        "VOCABULARY",
        approved,
      ),
    ).toEqual([]);
  });
});

describe("the role recorded on a decision", () => {
  it("is the role that grants review, not just the first admin role", () => {
    expect(reviewerRoleOf(["CURRICULUM_EDITOR", "CONTENT_REVIEWER"])).toBe("CONTENT_REVIEWER");
    expect(reviewerRoleOf(["CONTENT_REVIEWER", "SUPER_ADMIN"])).toBe("SUPER_ADMIN");
    expect(reviewerRoleOf(["CURRICULUM_EDITOR"])).toBe("UNKNOWN");
  });
});

describe("progress summary", () => {
  it("counts items by status and kind, and items blocked by sources", () => {
    const q = (
      type: QueueItem["entityType"],
      status: QueueItem["status"],
      blocked = false,
    ): QueueItem => ({
      entityType: type,
      entityId: Math.random().toString(36),
      title: "x",
      details: {},
      verification: "PROVISIONAL",
      status,
      fingerprint: "v1:x",
      sourceRefs: [],
      blockers: {
        REVIEWED: blocked ? [{ code: "source-not-approved", message: "m" }] : [],
        VERIFIED: [],
      },
      history: [],
      changedSinceApproval: [],
    });
    const p = summariseQueue("c", [
      q("CURRICULUM", "needs-review"),
      q("CHARACTER", "approved"),
      q("CHARACTER", "needs-review", true),
      q("VOCABULARY", "stale"),
    ]);
    expect(p).toMatchObject({ total: 3, curriculum: "needs-review", blockedBySources: 1 });
    expect(p.byStatus).toMatchObject({ approved: 1, "needs-review": 1, stale: 1 });
    expect(p.byKind.CHARACTER.approved).toBe(1);
  });
});
