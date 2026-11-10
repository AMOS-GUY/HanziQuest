import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Beta guide" };

export default function BetaGuidePage() {
  return (
    <article>
      <h1>Beta testing guide</h1>
      <p>
        Thanks for helping test HanziQuest! This page explains what to try, what we already know is
        unfinished, and how to tell us when something is wrong.
      </p>

      <h2>Getting started (10 minutes)</h2>
      <ul>
        <li>
          <Link href="/register">Create an account</Link> and answer the onboarding questions. Take
          the short placement check if you already know some characters.
        </li>
        <li>Open the first lesson, watch the stroke order, then trace and write each character.</li>
        <li>
          On your phone or tablet, add HanziQuest to your home screen (browser menu → “Install app”
          or “Add to Home Screen”).
        </li>
      </ul>

      <h2>What we&apos;d love you to test</h2>
      <ul>
        <li>
          <strong>Writing feedback:</strong> write characters correctly, then try a few mistakes on
          purpose: a stroke backwards, strokes in the wrong order, a missing stroke, a different
          character. Does the feedback match what you did?
        </li>
        <li>
          <strong>Reviews:</strong> come back the next day and use Review. Do characters come back
          at sensible times?
        </li>
        <li>
          <strong>Offline:</strong> download a lesson, switch on airplane mode, practise, then go
          back online. Does your progress appear?
        </li>
        <li>
          <strong>Different devices:</strong> finger on a phone, stylus on a tablet, mouse on a
          laptop.
        </li>
      </ul>

      <h2>How progress works</h2>
      <ul>
        <li>
          A character counts as <em>remembered</em> when you write the right character with all its
          strokes from memory. Tracing and hints help you learn but don&apos;t count.
        </li>
        <li>
          If you remember a character but draw a stroke backwards or in the wrong order, you still
          get some XP and it counts as remembered. It won&apos;t become <em>mastered</em> until you
          write it with the correct stroke order and direction, and it comes back sooner for review.
        </li>
        <li>Writing a different character never counts.</li>
      </ul>

      <h2>Known limitations</h2>
      <ul>
        <li>Only the HSK 1 starter course (16 lessons). The content is provisional.</li>
        <li>
          The handwriting checker only knows the course&apos;s characters and is still being
          validated with real handwriting. It may sometimes be wrong; please tell us when.
        </li>
        <li>No password-reset email yet. If you forget your password, contact us.</li>
        <li>Reviews need a connection; offline practice works for downloaded lessons.</li>
      </ul>

      <h2>Reporting a problem</h2>
      <p>
        Use <strong>Feedback</strong> in the app menu (or Profile → Send feedback). Choose “Bug”,
        say what you did, what you expected and what happened. The page you were on and your browser
        type are attached automatically. For grading problems, choose “Handwriting” and name the
        character.
      </p>
      <p>
        Please don&apos;t include passwords or other personal details in feedback. Security issues:
        email [security contact] instead of using the feedback form.
      </p>
    </article>
  );
}
