import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { SyncManager } from "@/components/offline/sync-manager";

/** Focused, navigation-free layout for practice sessions. */
export default async function PracticeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.profile?.onboardingCompletedAt) redirect("/onboarding");
  return (
    <main className="min-h-dvh px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-10">
      <SyncManager userId={user.id} />
      {children}
    </main>
  );
}
