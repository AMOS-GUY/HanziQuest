import Link from "next/link";
import { Logo, Wordmark } from "@/components/brand/logo";
import { SiteFooter } from "@/components/brand/site-footer";

/** Public information pages (privacy, terms, beta guide). No sign-in needed. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2" aria-label="HanziQuest home">
          <Logo size={36} />
          <Wordmark />
        </Link>
        <Link href="/register" className="text-primary text-sm font-bold">
          Join the beta
        </Link>
      </header>
      <main className="prose-hq flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
