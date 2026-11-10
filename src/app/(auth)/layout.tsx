import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo, Wordmark } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth/session";
import { SiteFooter } from "@/components/brand/site-footer";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/home");
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-8">
      <Link href="/" className="mb-8 flex items-center gap-2" aria-label="HanziQuest home">
        <Logo size={44} priority />
        <Wordmark />
      </Link>
      <div className="w-full max-w-sm flex-1">{children}</div>
      <div className="w-full max-w-sm">
        <SiteFooter />
      </div>
    </main>
  );
}
