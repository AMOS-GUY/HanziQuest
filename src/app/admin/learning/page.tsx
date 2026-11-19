import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import {
  DEFAULT_MIN_GROUP,
  learningAnalytics,
  learningAnalyticsEnabled,
  type PublicDistribution,
  type PublicRate,
} from "@/features/measurement/analytics";

export const metadata: Metadata = { title: "Learning measurement" };

const REASON = {
  "small-group": `fewer than ${DEFAULT_MIN_GROUP} learners`,
  dominated: "mostly one learner",
  complementary: "withheld (protects another cell)",
  "no-data": "no data yet",
} as const;

function Rate({ value }: { value: PublicRate }) {
  if (!value.shown) return <span className="text-muted-foreground">{REASON[value.reason]}</span>;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    <span>
      {pct(value.rate)}{" "}
      <span className="text-muted-foreground text-xs">
        ({pct(value.interval[0])}–{pct(value.interval[1])}, n {value.n}, {value.learners} learners)
      </span>
    </span>
  );
}

function Days({ value }: { value: PublicDistribution }) {
  if (!value.shown) return <span className="text-muted-foreground">{REASON[value.reason]}</span>;
  return (
    <span>
      {value.medianDays} days{" "}
      <span className="text-muted-foreground text-xs">
        (middle half {value.p25Days}–{value.p75Days}; n {value.n}, {value.notYet} not yet)
      </span>
    </span>
  );
}

/**
 * Aggregate learning measurement (M15-b). Off until the owner approves the privacy notice
 * wording and the legal-version decision (D-079): LEARNING_ANALYTICS=on enables it.
 */
export default async function LearningMeasurementPage() {
  const user = await requirePagePermission("analytics:read");
  if (!learningAnalyticsEnabled()) notFound();
  const cohorts = await learningAnalytics(prisma, user);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Learning measurement</h1>
        <p className="text-muted-foreground text-sm">
          Signup-week cohorts, aggregates only. Values describing fewer than {DEFAULT_MIN_GROUP}{" "}
          learners, or mostly one learner, are withheld. Staff and test accounts are excluded.
          Ranges are 95% intervals; event-level ones understate uncertainty when a few learners do
          most of the practice.
        </p>
      </div>
      {cohorts.map((c) => (
        // A section named by its heading (a plain div can't carry a name).
        <section key={c.week} aria-labelledby={`cohort-${c.week}`}>
          <Card>
            <CardTitle id={`cohort-${c.week}`} className="mb-3">
              Signed up in {c.week}:{" "}
              {c.learners.shown ? `${c.learners.count} learners` : REASON["small-group"]}
            </CardTitle>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              {c.funnel.map((f) => (
                <div key={f.stage} className="contents">
                  <dt>{f.label}</dt>
                  <dd>
                    <Rate value={f.reached} />
                  </dd>
                </div>
              ))}
              <dt>First lesson within 24 h</dt>
              <dd>
                <Rate value={c.activation} />
              </dd>
              <dt>Practised on day 1 / 7 / 30</dt>
              <dd className="flex flex-col">
                <Rate value={c.returns.d1} />
                <Rate value={c.returns.d7} />
                <Rate value={c.returns.d30} />
              </dd>
              <dt>Due reviews done within a day</dt>
              <dd>
                <Rate value={c.dueReviewCompletion} />
              </dd>
              {c.recallByInterval.map((b) => (
                <div key={b.bucket} className="contents">
                  <dt>Recall when due, interval {b.label}</dt>
                  <dd>
                    <Rate value={b.recall} />
                  </dd>
                </div>
              ))}
              <dt>Lapse rate</dt>
              <dd>
                <Rate value={c.lapseRate} />
              </dd>
              <dt>Days to Familiar</dt>
              <dd>
                <Days value={c.daysToFamiliar} />
              </dd>
              <dt>Days to Mastered</dt>
              <dd>
                <Days value={c.daysToMastered} />
              </dd>
              <dt>Placement accuracy</dt>
              <dd>
                <Rate value={c.placementAccuracy} />
              </dd>
            </dl>
          </Card>
        </section>
      ))}
    </div>
  );
}
