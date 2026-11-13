import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { ReviewProgress } from "@/features/curriculum/review";

const ROWS: { key: keyof ReviewProgress["byStatus"]; label: string }[] = [
  { key: "approved", label: "Approved (current version)" },
  { key: "needs-review", label: "Needs review" },
  { key: "changes-requested", label: "Changes requested" },
  { key: "stale", label: "Changed since approval" },
  { key: "unreviewed-status", label: "Status without a review record" },
];

const CURRICULUM_STATUS: Record<ReviewProgress["curriculum"], string> = {
  approved: "approved (current version)",
  "needs-review": "not approved yet",
  "changes-requested": "changes requested",
  stale: "changed since approval",
  "unreviewed-status": "has a status without a review record",
};

/** Review progress for one curriculum (M14-b step 4). */
export function ReviewProgressSummary({ progress: p }: { progress: ReviewProgress }) {
  const pct = p.total ? Math.round((100 * p.byStatus.approved) / p.total) : 0;
  return (
    <Card>
      <CardTitle className="mb-1">Review progress</CardTitle>
      <CardDescription className="mb-3">
        {p.byStatus.approved} of {p.total} characters and words approved ({pct}%). The curriculum
        itself is {CURRICULUM_STATUS[p.curriculum]}.
        {p.blockedBySources
          ? ` ${p.blockedBySources} item(s) can't be approved until their sources are approved by the owner.`
          : ""}
      </CardDescription>
      <div
        role="region"
        aria-label="Review progress (scrolls sideways)"
        tabIndex={0}
        className="overflow-x-auto"
      >
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="text-muted-foreground border-border border-b-2">
            <tr>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Characters</th>
              <th className="py-2 pr-3">Words</th>
              <th className="py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} className="border-border border-b last:border-0">
                <td className="py-2 pr-3">{r.label}</td>
                <td className="py-2 pr-3">{p.byKind.CHARACTER[r.key]}</td>
                <td className="py-2 pr-3">{p.byKind.VOCABULARY[r.key]}</td>
                <td className="py-2">{p.byStatus[r.key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
