import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";
import { registrationMode } from "@/features/invites/invites";

export const metadata: Metadata = { title: "Create your account" };

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const inviteRequired = registrationMode() === "invite";
  const { invite } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-black">Start your quest</h1>
      <p className="text-muted-foreground mb-6">
        {inviteRequired
          ? "The HanziQuest beta is invite-only for now. Enter the code you were given."
          : "Create a free account to save your progress."}
      </p>
      <RegisterForm
        inviteRequired={inviteRequired}
        defaultInvite={typeof invite === "string" ? invite.slice(0, 40) : ""}
      />
      <p className="text-muted-foreground mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-primary font-bold hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
