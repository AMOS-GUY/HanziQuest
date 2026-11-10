import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, PenLine, Repeat, WifiOff } from "lucide-react";
import { Logo, Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { SiteFooter } from "@/components/brand/site-footer";

const FEATURES = [
  {
    icon: PenLine,
    title: "Write, don't just tap",
    text: "Practise every character by hand, stroke by stroke.",
  },
  {
    icon: BookOpen,
    title: "A clear path",
    text: "Start at HSK 1 and build vocabulary lesson by lesson.",
  },
  {
    icon: Repeat,
    title: "Remember it",
    text: "Characters come back for review right when you need them.",
  },
  {
    icon: WifiOff,
    title: "Learn anywhere",
    text: "Install it like an app and download lessons to practise offline.",
  },
];

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/home");
  const { deleted } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2" aria-label="HanziQuest home">
          <Logo size={40} priority />
          <Wordmark />
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link href="/login">Log in</Link>
        </Button>
      </header>

      {deleted ? (
        <p
          role="status"
          className="bg-accent text-accent-foreground mt-6 rounded-xl px-4 py-3 font-bold"
        >
          Your account and learning data have been deleted.
        </p>
      ) : null}
      <section className="grid flex-1 items-center gap-10 py-10 md:grid-cols-2 md:py-16">
        <div className="order-2 md:order-1">
          <p className="bg-accent text-accent-foreground mb-3 inline-block rounded-full px-3 py-1 text-sm font-bold">
            Public beta
          </p>
          <h1 className="text-4xl leading-tight font-black sm:text-5xl">
            Learn to write Chinese characters,{" "}
            <span className="text-primary">one stroke at a time.</span>
          </h1>
          <p className="text-muted-foreground mt-4 max-w-md text-lg">
            HanziQuest helps you recognise, remember and correctly write Hanzi — with stroke-order
            practice, writing feedback and spaced review.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/register">Join the free beta</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
        <div className="order-1 flex justify-center md:order-2">
          <div className="relative">
            <Logo size={260} priority className="shadow-[0_12px_40px_-12px_rgba(7,91,77,0.45)]" />
            <span
              lang="zh"
              aria-hidden
              className="hanzi border-border bg-surface text-primary absolute -right-4 -bottom-4 rounded-2xl border-2 px-3 py-1 text-3xl font-bold shadow-sm"
            >
              汉字
            </span>
          </div>
        </div>
      </section>

      <section
        aria-label="What you can do"
        className="grid gap-4 pb-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div
            key={title}
            className="border-border bg-surface rounded-[var(--radius-card)] border-2 p-4"
          >
            <Icon className="text-primary mb-2 size-6" aria-hidden />
            <h2 className="font-extrabold">{title}</h2>
            <p className="text-muted-foreground text-sm">{text}</p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="beta"
        className="border-border bg-surface rounded-[var(--radius-card)] border-2 p-5"
      >
        <h2 id="beta" className="text-xl font-extrabold">
          How the beta works
        </h2>
        <ul className="text-muted-foreground mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <li>
            <strong className="text-foreground">Free while in beta.</strong> HSK 1 starter course
            (16 lessons, 102 characters). Content is marked provisional until a teacher has reviewed
            it.
          </li>
          <li>
            <strong className="text-foreground">Honest feedback.</strong> The writing checker knows
            the course&apos;s characters and is still being tested with real handwriting. Tell us
            when it gets something wrong.
          </li>
          <li>
            <strong className="text-foreground">Your data.</strong> No ads or trackers. Delete your
            account any time. Read the{" "}
            <Link href="/privacy" className="text-primary font-bold underline">
              privacy notice
            </Link>{" "}
            and{" "}
            <Link href="/beta-guide" className="text-primary font-bold underline">
              beta guide
            </Link>
            .
          </li>
        </ul>
      </section>
      <SiteFooter />
    </main>
  );
}
