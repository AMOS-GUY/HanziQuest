import { Logo, Wordmark } from "@/components/brand/logo";
import { requireUser } from "@/lib/auth/session";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 px-4 py-4">
        <Logo size={32} />
        <Wordmark className="text-lg" />
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-10">{children}</main>
    </div>
  );
}
