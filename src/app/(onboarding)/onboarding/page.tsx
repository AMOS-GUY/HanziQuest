import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.profile?.onboardingCompletedAt) redirect("/home");
  return <OnboardingFlow name={user.profile?.displayName ?? user.name ?? ""} />;
}
