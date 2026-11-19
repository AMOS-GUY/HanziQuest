import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ActionButton } from "@/components/admin/action-button";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import {
  DISPUTE_OUTCOMES,
  DISPUTE_REASONS,
  disputeCounts,
  disputeQueue,
} from "@/features/handwriting/disputes";
import {
  claimDisputeAction,
  decideDisputeAction,
  releaseDisputeAction,
} from "@/features/handwriting/dispute-actions";
import type { DisputeStatus } from "@/generated/prisma/enums";
import type { InkStroke } from "@/features/handwriting/types";

export const metadata: Metadata = { title: "Handwriting disputes" };

const FILTERS = ["OPEN", "RESOLVED", "DISMISSED"] as const;
const REASON = Object.fromEntries(DISPUTE_REASONS.map((r) => [r.key, r.label]));
const OUTCOME = Object.fromEntries(DISPUTE_OUTCOMES.map((o) => [o.key, o.label]));
const STATUS: Record<DisputeStatus, string> = {
  SUBMITTED: "Waiting",
  UNDER_REVIEW: "Being reviewed",
  RESOLVED: "Decided",
  DISMISSED: "Dismissed",
};

/** The learner's ink for one character, drawn as written (coordinates are 0–1). */
function Ink({ strokes, label }: { strokes: InkStroke[]; label: string }) {
  return (
    <svg
      viewBox="-0.05 -0.05 1.1 1.1"
      role="img"
      aria-label={label}
      className="border-border bg-surface size-32 rounded-xl border-2"
    >
      <path d="M0.5 0V1M0 0.5H1" className="stroke-border" strokeWidth={0.005} fill="none" />
      {strokes.map((s, i) => (
        <polyline
          key={i}
          points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          className="stroke-foreground"
          strokeWidth={0.035}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * Handwriting disputes for reviewers (M13, D-081). No learner identifiers: reviewers judge the
 * writing. A finding never changes the learner's result or progress.
 */
export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePagePermission("handwriting:review-disputes");
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as (typeof FILTERS)[number])
    : "OPEN";
  const [items, counts] = await Promise.all([
    disputeQueue(prisma, user, { status: filter }),
    disputeCounts(prisma, user),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Handwriting disputes</h1>
        <p className="text-muted-foreground text-sm">
          Learners who think a result was wrong. Your finding is evidence for handwriting
          validation: it never changes the learner&apos;s result, XP, mastery or reviews. You
          can&apos;t review a dispute you submitted.
        </p>
      </div>

      <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/disputes?status=${f}`}
            aria-current={f === filter ? "true" : undefined}
            className="border-border aria-[current=true]:border-primary rounded-full border-2 px-3 py-1 font-bold"
          >
            {f === "OPEN"
              ? `Open (${(counts.SUBMITTED ?? 0) + (counts.UNDER_REVIEW ?? 0)})`
              : `${STATUS[f]} (${counts[f] ?? 0})`}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((d) => {
            const headingId = `dispute-${d.id}`;
            return (
              <li key={d.id}>
                <article aria-labelledby={headingId}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id={headingId} className="text-lg font-black">
                        <span lang="zh" className="hanzi">
                          {d.characters.join("")}
                        </span>{" "}
                        <span className="text-muted-foreground text-sm font-bold">
                          dispute {d.id.slice(-6)}
                        </span>
                      </h2>
                      <Badge variant={d.status === "UNDER_REVIEW" ? "warning" : "muted"}>
                        {STATUS[d.status]}
                      </Badge>
                    </div>
                    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                      <dt className="text-muted-foreground">Learner says</dt>
                      <dd>{REASON[d.reason]}</dd>
                      <dt className="text-muted-foreground">Original result</dt>
                      <dd>
                        {d.originalResult.toLowerCase().replace("_", " ")} (engine{" "}
                        {d.engineVersion ?? "unknown"})
                      </dd>
                      <dt className="text-muted-foreground">Submitted</dt>
                      <dd>{d.createdAt.toISOString().slice(0, 10)}</dd>
                      {d.outcome ? (
                        <>
                          <dt className="text-muted-foreground">Finding</dt>
                          <dd>{OUTCOME[d.outcome]}</dd>
                        </>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap gap-4">
                      {d.characters.map((hanzi, i) => (
                        <figure key={i} className="flex flex-col items-center gap-1 text-xs">
                          <Ink
                            strokes={d.ink[i] ?? []}
                            label={`Learner's writing for ${hanzi}, ${d.ink[i]?.length ?? 0} strokes`}
                          />
                          <figcaption className="text-center">
                            Expected <span lang="zh">{hanzi}</span> ·{" "}
                            {d.evaluation[i]?.band.toLowerCase().replace("_", " ")}
                            {d.evaluation[i]?.bestMatch && d.evaluation[i]!.bestMatch !== hanzi ? (
                              <>
                                {" "}
                                · looked like <span lang="zh">{d.evaluation[i]!.bestMatch}</span>
                              </>
                            ) : null}
                            {d.evaluation[i]?.findings.length ? (
                              <span className="text-muted-foreground block">
                                {d.evaluation[i]!.findings.join(", ")}
                              </span>
                            ) : null}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                    {d.ownDispute ? (
                      <p className="text-muted-foreground text-sm" role="note">
                        You submitted this dispute, so another reviewer has to review it.
                      </p>
                    ) : d.status === "SUBMITTED" ? (
                      <ActionButton
                        action={claimDisputeAction.bind(null, d.id)}
                        label="Review this"
                      />
                    ) : d.status === "UNDER_REVIEW" && d.claimedByViewer ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-sm font-bold">Your finding:</span>
                        {DISPUTE_OUTCOMES.map((o) => (
                          <ActionButton
                            key={o.key}
                            action={decideDisputeAction.bind(null, d.id, o.key)}
                            label={o.label}
                          />
                        ))}
                        <ActionButton
                          action={releaseDisputeAction.bind(null, d.id)}
                          label="Release"
                        />
                      </div>
                    ) : d.claimedByOther ? (
                      <p className="text-muted-foreground text-sm">
                        Another reviewer is reviewing this.
                      </p>
                    ) : null}
                  </Card>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
