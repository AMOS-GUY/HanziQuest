import type { Metadata } from "next";
import { DraftNotice } from "@/components/brand/site-footer";
import { LEGAL_VERSION } from "@/features/legal/version";

export const metadata: Metadata = { title: "Beta terms" };

export default function TermsPage() {
  return (
    <article>
      <h1>Beta terms of use</h1>
      <p className="text-muted-foreground text-sm">Version {LEGAL_VERSION}</p>
      <DraftNotice />

      <h2>1. What the beta is</h2>
      <p>
        HanziQuest is in public beta. It is offered free of charge while we test it. Features may
        change, break or be removed, and data may occasionally need to be reset. In that case we
        will tell you first where we can.
      </p>

      <h2>2. Learning content</h2>
      <p>
        The HSK 1 starter content is marked “Provisional”: its glosses and pinyin have not yet been
        checked by a qualified teacher. It is not official HSK material and not affiliated with any
        examination body.
      </p>

      <h2>3. Handwriting feedback</h2>
      <p>
        The handwriting checker compares your writing with the characters taught in the course. It
        is not general handwriting recognition, and its accuracy with real handwriting is still
        being measured. Treat its feedback as guidance, not as an authoritative judgement or exam
        result.
      </p>

      <h2>4. Your account</h2>
      <ul>
        <li>Keep your password private. You are responsible for activity on your account.</li>
        <li>One account per person. Don&apos;t create accounts automatically.</li>
        <li>You can delete your account at any time in Profile.</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>
        Don&apos;t try to break, overload or gain unauthorised access to HanziQuest or other
        people&apos;s accounts; don&apos;t manipulate XP or progress; don&apos;t submit unlawful or
        abusive content in feedback. We may suspend accounts that do, and we record such actions.
      </p>

      <h2>6. Feedback</h2>
      <p>
        Thank you for testing! You agree that we may use the feedback you send to improve
        HanziQuest, without obligation to you.
      </p>

      <h2>7. No warranty</h2>
      <p>
        The beta is provided “as is” without warranties of any kind, to the extent the law allows.
        [Limitation of liability wording appropriate to the operator&apos;s jurisdiction.]
      </p>

      <h2>8. Changes and ending the beta</h2>
      <p>
        We may change these terms; if the change is material we will ask you to accept the new
        version. We may end the beta at any time. If HanziQuest later introduces paid plans, they
        will come with separate terms that you choose whether to accept.
      </p>

      <h2>9. Contact and law</h2>
      <p>
        Operator: [operator name and address]. Contact: [contact email]. Governing law:
        [jurisdiction].
      </p>
    </article>
  );
}
