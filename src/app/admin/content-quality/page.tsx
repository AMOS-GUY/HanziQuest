import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { contentQualityReport } from "@/features/curriculum/quality";
import { reviewProgress } from "@/features/curriculum/review";

export const metadata = { title: "Content quality" };
export const dynamic = "force-dynamic";

const SEVERITY = {
  error: { label: "Error", variant: "danger" },
  warning: { label: "Warning", variant: "warning" },
  info: { label: "Note", variant: "muted" },
} as const;

export default async function ContentQualityPage() {
  const user = await requirePagePermission("curriculum:read");
  const report = await contentQualityReport(prisma);
  // Review progress for published curricula (M14-b step 4). Drafts are reviewed from the queue.
  const published = await prisma.curriculum.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, version: true },
  });
  const reviews = await Promise.all(
    published.map(async (c) => ({ ...c, progress: await reviewProgress(prisma, c.id) })),
  );
  const canReview = user.permissions.has("curriculum:review");
  const counts = {
    error: report.findings.filter((f) => f.severity === "error").length,
    warning: report.findings.filter((f) => f.severity === "warning").length,
    info: report.findings.filter((f) => f.severity === "info").length,
  };
  const t = report.totals;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-3xl font-black">Content quality</h1>
        <p className="text-muted-foreground text-sm">
          Missing, inconsistent or unverified content across all curricula. {counts.error} errors,{" "}
          {counts.warning} warnings, {counts.info} notes.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle className="text-base">Characters</CardTitle>
          <p className="text-3xl font-black">{t.characters}</p>
          <p className="text-muted-foreground text-sm">
            {Object.entries(t.charactersByVerification)
              .map(([k, v]) => `${v} ${k.toLowerCase()}`)
              .join(" · ")}
          </p>
        </Card>
        <Card>
          <CardTitle className="text-base">Words</CardTitle>
          <p className="text-3xl font-black">{t.words}</p>
          <p className="text-muted-foreground text-sm">
            {Object.entries(t.wordsByVerification)
              .map(([k, v]) => `${v} ${k.toLowerCase()}`)
              .join(" · ")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t.wordsWithoutExample} without an example sentence · {t.wordsWithoutAudio} without
            audio
          </p>
        </Card>
        <Card>
          <CardTitle className="text-base">Published exercises</CardTitle>
          <p className="text-3xl font-black">{t.publishedExercises}</p>
        </Card>
      </div>

      <Card>
        <CardTitle className="mb-3">Curricula</CardTitle>
        <div
          role="region"
          aria-label="Curricula quality (scrolls sideways)"
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Verification</th>
                <th className="py-2 pr-4">Licence</th>
                <th className="py-2">Lessons</th>
              </tr>
            </thead>
            <tbody>
              {report.curricula.map((c) => (
                <tr key={c.id} className="border-border border-t">
                  <td className="py-2 pr-4 font-semibold">
                    <Link
                      href={`/admin/curricula/${c.id}`}
                      className="underline underline-offset-4"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{c.status.toLowerCase()}</td>
                  <td className="py-2 pr-4">{c.verification.toLowerCase()}</td>
                  <td className="py-2 pr-4">{c.licenseStatus.toLowerCase().replace("_", " ")}</td>
                  <td className="py-2">
                    {c.publishedLessons} published · {c.draftLessons} draft
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-3">Review progress (published curricula)</CardTitle>
        {reviews.length === 0 ? (
          <p className="text-muted-foreground">No published curriculum.</p>
        ) : (
          <div
            role="region"
            aria-label="Review progress (scrolls sideways)"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b-2">
                <tr>
                  <th className="py-2 pr-4">Curriculum</th>
                  <th className="py-2 pr-4">Items approved</th>
                  <th className="py-2 pr-4">Needs review</th>
                  <th className="py-2 pr-4">Changed since approval</th>
                  <th className="py-2 pr-4">Blocked by sources</th>
                  <th className="py-2">Curriculum</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id} className="border-border border-b last:border-0">
                    <td className="py-2 pr-4">
                      {canReview ? (
                        <Link
                          href={`/admin/review?c=${r.id}`}
                          className="underline underline-offset-4"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}{" "}
                      <span className="text-muted-foreground">({r.version})</span>
                    </td>
                    <td className="py-2 pr-4">
                      {r.progress.byStatus.approved} / {r.progress.total}
                    </td>
                    <td className="py-2 pr-4">
                      {r.progress.byStatus["needs-review"] +
                        r.progress.byStatus["changes-requested"]}
                    </td>
                    <td className="py-2 pr-4">{r.progress.byStatus.stale}</td>
                    <td className="py-2 pr-4">{r.progress.blockedBySources}</td>
                    <td className="py-2">
                      {r.progress.curriculum === "approved" ? "approved" : "not approved"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-3">Findings</CardTitle>
        {report.findings.length === 0 ? (
          <p className="text-muted-foreground">No problems found.</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {report.findings.map((f, i) => (
              <li key={i} className="flex flex-wrap items-start gap-3 py-2">
                <Badge variant={SEVERITY[f.severity].variant}>{SEVERITY[f.severity].label}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold" lang="zh">
                    {f.href ? (
                      <Link href={f.href} className="underline underline-offset-4">
                        {f.key}
                      </Link>
                    ) : (
                      f.key
                    )}
                  </span>{" "}
                  <span className="text-muted-foreground text-xs">({f.area})</span>
                  <br />
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
