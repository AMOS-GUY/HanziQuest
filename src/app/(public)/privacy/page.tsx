import type { Metadata } from "next";
import { DraftNotice } from "@/components/brand/site-footer";
import { LEGAL_VERSION } from "@/features/legal/version";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy notice</h1>
      <p className="text-muted-foreground text-sm">Version {LEGAL_VERSION}</p>
      <DraftNotice />

      <p>
        This notice explains what HanziQuest stores about you during the public beta, why, and what
        you can do about it. HanziQuest is operated by [operator name and address]. Contact:
        [privacy contact email].
      </p>

      <h2>What we store</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email address, display name, password (stored only as a one-way bcrypt hash)</td>
            <td>To create and secure your account.</td>
          </tr>
          <tr>
            <td>
              Onboarding answers (experience, goals, self-reported HSK level), daily goal, time zone
            </td>
            <td>To suggest where to start and to count days and streaks in your time zone.</td>
          </tr>
          <tr>
            <td>
              Practice history: the strokes you draw (positions and timing), the grading result, XP,
              mastery, review schedule, lessons completed
            </td>
            <td>
              To grade your writing, track your progress, schedule reviews, and improve the
              handwriting checker.
            </td>
          </tr>
          <tr>
            <td>
              Security records: sign-ins, account and staff actions, with IP address and browser
              user agent
            </td>
            <td>
              To protect accounts, investigate abuse and keep an audit trail of staff actions.
            </td>
          </tr>
          <tr>
            <td>Feedback and bug reports you send, with the page you were on and browser type</td>
            <td>To fix problems and improve the beta.</td>
          </tr>
          <tr>
            <td>Error reports (the error, page path and app version; no account identifiers)</td>
            <td>To find and fix crashes.</td>
          </tr>
        </tbody>
      </table>
      <p>
        We do not use advertising, analytics trackers or third-party cookies. We do not sell your
        data. We only use one essential cookie, to keep you signed in.
      </p>

      <h2>Stored on your device</h2>
      <p>
        If you download lessons for offline use, they are stored in your browser. Practice you do
        offline is kept there until it syncs. Downloads are removed when you log out. Unsynced
        practice stays on the device, linked to your account only, until it syncs or you choose to
        delete it when logging out. A random device ID (not linked to your hardware) is stored so
        sync can avoid duplicates.
      </p>

      <h2>Who processes it</h2>
      <p>
        Data is stored with our hosting provider [hosting provider] and database provider [database
        provider] in [region]. If error reporting is enabled, error reports go to [error reporting
        provider]. Staff can see account details and practice history only where their role needs
        it, and every staff change is logged.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Account and practice data: until you delete your account (Profile → Delete my account),
          which removes it immediately.
        </li>
        <li>
          Security and audit records: [retention period]. When you delete your account, these
          records stay but are no longer linked to your account.
        </li>
        <li>Feedback: [retention period], then deleted or anonymised.</li>
        <li>
          Database backups: up to [backup retention], after which deleted data is gone from them
          too.
        </li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Change your name, daily goal and time zone in Profile.</li>
        <li>Delete your account and learning data at any time in Profile.</li>
        <li>
          Ask for a copy of your data or a correction by writing to [privacy contact email]. There
          is no self-service export yet.
        </li>
        <li>[Rights and complaint options that apply in the operator&apos;s jurisdiction.]</li>
      </ul>

      <h2>Children</h2>
      <p>[Minimum age and parental consent rules, to be decided by the operator.]</p>

      <h2>Handwriting study</h2>
      <p>
        Separately from normal use, staff may invite people to a handwriting test session. Those
        samples are stored with a code (for example “P03”), never a name, and only with the
        person&apos;s spoken consent.
      </p>

      <h2>Changes</h2>
      <p>
        If this notice changes materially, we will ask you to accept the new version when you next
        use HanziQuest.
      </p>
    </article>
  );
}
