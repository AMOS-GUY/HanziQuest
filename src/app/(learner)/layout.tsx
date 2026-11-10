import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo, Wordmark } from "@/components/brand/logo";
import { LearnerBottomNav, LearnerSidebar } from "@/components/navigation/learner-nav";
import { requireUser } from "@/lib/auth/session";
import { SyncManager } from "@/components/offline/sync-manager";
import { TermsPrompt } from "@/components/feedback/terms-prompt";
import { LEGAL_VERSION } from "@/features/legal/version";

export default async function LearnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.profile?.onboardingCompletedAt) redirect("/onboarding");
  const showAdmin = user.permissions.has("admin:access");
  return (
    <div className="flex min-h-dvh">
      <LearnerSidebar showAdmin={showAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex items-center justify-between border-b-2 px-4 py-3 md:hidden">
          <Link href="/home" className="flex items-center gap-2" aria-label="HanziQuest home">
            <Logo size={32} />
            <Wordmark className="text-lg" />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/feedback" className="text-primary text-sm font-bold">
              Feedback
            </Link>
            {showAdmin ? (
              <Link href="/admin" className="text-primary text-sm font-bold">
                Admin
              </Link>
            ) : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pb-10">
          {user.profile?.termsVersion !== LEGAL_VERSION ? <TermsPrompt /> : null}
          {children}
        </main>
      </div>
      <LearnerBottomNav />
      <SyncManager userId={user.id} />
    </div>
  );
}
