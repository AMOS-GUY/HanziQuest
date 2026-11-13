import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminForm } from "@/components/admin/admin-form";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { sourceRegister } from "@/features/curriculum/sources";
import {
  reviewQueue,
  summariseQueue,
  type QueueItem,
  type ReviewStatus,
} from "@/features/curriculum/review";
import { recordReviewAction } from "@/features/administration/review-actions";
import { ReviewProgressSummary } from "./progress-summary";

export const metadata: Metadata = { title: "Content review" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** Readable labels for the details shown per item. */
const DETAIL_LABEL: Record<string, string> = {
  pinyin: "Pinyin",
  meaning: "Meaning",
  traditional: "Traditional",
  partOfSpeech: "Part of speech",
  example: "Example",
  framework: "Framework",
  version: "Version",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  "needs-review": "Needs review",
  "changes-requested": "Changes requested",
  stale: "Changed since approval",
  approved: "Approved (current version)",
  "unreviewed-status": "Status without a review record",
};

const STATUS_VARIANT: Record<ReviewStatus, "warning" | "muted" | "default" | "danger"> = {
  "needs-review": "warning",
  "changes-requested": "danger",
  stale: "danger",
  approved: "default",
  "unreviewed-status": "warning",
};

const KIND_LABEL = {
  CURRICULUM: "Curriculum",
  CHARACTER: "Character",
  VOCABULARY: "Word",
} as const;

const FILTERS = ["open", "all", "needs-review", "changes-requested", "stale", "approved"] as const;
type Filter = (typeof FILTERS)[number];

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; status?: string; kind?: string; page?: string }>;
}) {
  await requirePagePermission("curriculum:review");
  const sp = await searchParams;
  const curricula = await prisma.curriculum.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, status: true, version: true },
  });
  const current = curricula.find((c) => c.id === sp.c) ?? curricula[0];
  if (!current)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-black">Content review</h1>
        <p className="text-muted-foreground">There is no curriculum to review yet.</p>
      </div>
    );

  const register = sourceRegister();
  const sources = new Map(register.sources.map((s) => [s.id, s]));
  const queue = await reviewQueue(prisma, current.id, register);
  const progress = summariseQueue(current.id, queue);
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as Filter)
    : "open";
  const kind =
    sp.kind === "CHARACTER" || sp.kind === "VOCABULARY" || sp.kind === "CURRICULUM"
      ? sp.kind
      : null;
  const shown = queue.filter(
    (q) =>
      (!kind || q.entityType === kind) &&
      (filter === "all" || (filter === "open" ? q.status !== "approved" : q.status === filter)),
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const items = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { c: current.id, status: filter, kind, page: null, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, String(v));
    return `/admin/review?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Content review</h1>
        <p className="text-muted-foreground text-sm">
          Approve exact versions of characters, words and curricula. An approval applies only to the
          version you see: any later change to the content or its sources returns the item to
          Provisional. You can&apos;t approve a version you changed or imported. Reviewed and
          Verified stay distinct: Verified needs a second reviewer, after someone else approved the
          same version as Reviewed. Nothing is shown to learners as official.
        </p>
      </div>

      <nav aria-label="Curricula" className="flex flex-wrap gap-2">
        {curricula.map((c) => (
          <Link
            key={c.id}
            href={`/admin/review?c=${c.id}`}
            aria-current={c.id === current.id ? "page" : undefined}
            className="border-border aria-[current=page]:border-primary aria-[current=page]:bg-accent rounded-full border-2 px-3 py-1 text-sm font-bold"
          >
            {c.name}{" "}
            <span className="text-muted-foreground font-normal">
              ({c.version}, {c.status.toLowerCase()})
            </span>
          </Link>
        ))}
      </nav>

      <ReviewProgressSummary progress={progress} />

      <nav aria-label="Filter" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">Show:</span>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={href({ status: f })}
            aria-current={f === filter ? "true" : undefined}
            className="border-border aria-[current=true]:border-primary rounded-full border-2 px-3 py-1"
          >
            {f === "open" ? "Open" : f === "all" ? "All" : STATUS_LABEL[f]}
          </Link>
        ))}
        <span className="ml-2 font-bold">Kind:</span>
        {([null, "CURRICULUM", "CHARACTER", "VOCABULARY"] as const).map((k) => (
          <Link
            key={k ?? "any"}
            href={href({ kind: k })}
            aria-current={k === kind ? "true" : undefined}
            className="border-border aria-[current=true]:border-primary rounded-full border-2 px-3 py-1"
          >
            {k ? KIND_LABEL[k] : "Any"}
          </Link>
        ))}
      </nav>

      <p className="text-muted-foreground text-sm" role="status">
        {shown.length} item(s){pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
      </p>

      <ul className="flex flex-col gap-4">
        {items.map((q) => (
          <li key={`${q.entityType}:${q.entityId}`}>
            <ReviewItem item={q} sourceLabel={(id) => sources.get(id)} />
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav aria-label="Pages" className="flex gap-3 text-sm font-bold">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : null}
          {page < pageCount ? <Link href={href({ page: String(page + 1) })}>Next</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

function ReviewItem({
  item: q,
  sourceLabel,
}: {
  item: QueueItem;
  sourceLabel: (
    id: string,
  ) => { title: string; approval: { status: string }; licenseStatus: string } | undefined;
}) {
  const headingId = `review-${q.entityType}-${q.entityId}`;
  return (
    // An article named by its heading: groups each item's details and its "Record decision"
    // form for screen readers (a plain div can't carry a name).
    <article aria-labelledby={headingId}>
      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-xl font-black">
            <span className="text-muted-foreground mr-2 text-sm font-bold">
              {KIND_LABEL[q.entityType]}
            </span>
            {q.entityType === "CURRICULUM" ? (
              q.title
            ) : (
              <span lang="zh" className="hanzi">
                {q.title}
              </span>
            )}
          </h2>
          <Badge variant={STATUS_VARIANT[q.status]}>{STATUS_LABEL[q.status]}</Badge>
          <Badge variant="muted">{q.verification}</Badge>
        </div>

        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {Object.entries(q.details)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{DETAIL_LABEL[k] ?? k}</dt>
                <dd lang={k === "example" ? "zh" : undefined}>{v}</dd>
              </div>
            ))}
          <dt className="text-muted-foreground">Sources</dt>
          <dd>
            {q.sourceRefs.length ? (
              <ul className="flex flex-wrap gap-2">
                {q.sourceRefs.map((ref) => {
                  const s = sourceLabel(ref);
                  return (
                    <li key={ref}>
                      <code>{ref}</code>{" "}
                      <Badge variant={s?.approval.status === "APPROVED" ? "default" : "warning"}>
                        {s
                          ? s.approval.status === "APPROVED"
                            ? "approved"
                            : "awaiting owner approval"
                          : "not registered"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              "none recorded"
            )}
          </dd>
          <dt className="text-muted-foreground">Fingerprint</dt>
          <dd>
            <code className="text-xs">{q.fingerprint.slice(0, 19)}…</code>
          </dd>
        </dl>

        {q.changedSinceApproval.length ? (
          <p className="mt-2 text-sm">
            <span className="font-bold">Changed since the last approval:</span>{" "}
            {q.changedSinceApproval.join(", ")}
          </p>
        ) : null}

        {q.blockers.REVIEWED.length ? (
          <div className="mt-3 text-sm" role="note">
            <p className="font-bold">Can&apos;t be approved yet:</p>
            <ul className="list-disc pl-5">
              {q.blockers.REVIEWED.map((b) => (
                <li key={b.message}>{b.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {q.history.length ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-bold">
              Review history ({q.history.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {q.history.map((h) => (
                <li key={`${h.createdAt.toISOString()}-${h.fingerprint}`}>
                  {h.createdAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                  {h.decision === "APPROVED"
                    ? `approved as ${h.level?.toLowerCase()}`
                    : "changes requested"}{" "}
                  by a {h.reviewerRole.toLowerCase().replace("_", " ")}
                  {h.fingerprint === q.fingerprint ? " (this version)" : " (an earlier version)"}
                  {h.note ? `: “${h.note}”` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="mt-4">
          <AdminForm
            action={recordReviewAction}
            submitLabel="Record decision"
            fields={[
              { name: "entityType", type: "hidden", label: "Kind", defaultValue: q.entityType },
              { name: "entityId", type: "hidden", label: "Item", defaultValue: q.entityId },
              {
                name: "fingerprint",
                type: "hidden",
                label: "Version",
                defaultValue: q.fingerprint,
              },
              {
                name: "decision",
                label: "Decision",
                type: "select",
                required: true,
                options: [
                  { value: "REQUEST_CHANGES", label: "Request changes (stays Provisional)" },
                  { value: "APPROVE_REVIEWED", label: "Approve as Reviewed" },
                  {
                    value: "APPROVE_VERIFIED",
                    label:
                      "Approve as Verified (second reviewer, after Reviewed; licensed sources only)",
                  },
                ],
              },
              {
                name: "note",
                label: "Note",
                type: "textarea",
                rows: 2,
                help: "Required when requesting changes. Shown in the review history.",
                wide: true,
              },
            ]}
          />
        </div>
      </Card>
    </article>
  );
}
