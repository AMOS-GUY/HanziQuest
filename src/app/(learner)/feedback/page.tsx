import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { requireUser } from "@/lib/auth/session";
import { submitFeedbackAction } from "@/features/feedback/actions";
import { FEEDBACK_KINDS, FEEDBACK_LABEL } from "@/features/feedback/feedback";

export const metadata: Metadata = { title: "Send feedback" };

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; from?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const kind = FEEDBACK_KINDS.includes(sp.kind as never) ? sp.kind : "BUG";
  const from = sp.from && /^\/[^\s]{0,199}$/.test(sp.from) ? sp.from : "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Send feedback</h1>
        <p className="text-muted-foreground">
          Found a bug, a wrong grade or a mistake in the content? Tell us. Every message is read by
          the team. See the{" "}
          <Link href="/beta-guide" className="text-primary font-bold underline">
            beta guide
          </Link>{" "}
          for what helps most.
        </p>
      </div>
      <Card>
        <CardDescription className="mb-4">
          For a bug, say what you did, what you expected and what happened instead. The page you
          came from and your browser type (not your device ID) are included automatically. Please
          don&apos;t include passwords or other personal details.
        </CardDescription>
        <AdminForm
          action={submitFeedbackAction}
          submitLabel="Send feedback"
          resetOnSuccess
          fields={[
            {
              name: "kind",
              label: "What is it about?",
              type: "select",
              defaultValue: kind,
              options: FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_LABEL[k] })),
              wide: true,
            },
            { name: "message", label: "Your message", type: "textarea", rows: 6, required: true },
            { name: "pagePath", label: "", type: "hidden", defaultValue: from },
            {
              name: "allowContact",
              label: "May we email you about this?",
              type: "select",
              defaultValue: "no",
              options: [
                { value: "no", label: "No, thanks" },
                { value: "yes", label: "Yes, you may email me about it" },
              ],
              wide: true,
            },
          ]}
        />
      </Card>
    </div>
  );
}
