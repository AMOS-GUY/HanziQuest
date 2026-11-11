import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/database/prisma";
import { resetTokenUsable } from "@/features/account/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const usable = await resetTokenUsable(prisma, token);
  return (
    <>
      <h1 className="mb-1 text-3xl font-black">Choose a new password</h1>
      {usable ? (
        <>
          <p className="text-muted-foreground mb-6">
            You&apos;ll be signed out on every device, then you can log in with the new password.
          </p>
          <ResetPasswordForm token={token} />
        </>
      ) : !token ? (
        <p role="alert" className="text-muted-foreground mt-2">
          Open the reset link you were given again. For safety, this page removes it from the
          address bar once it has loaded.{" "}
          <Link href="/login" className="text-primary font-bold hover:underline">
            Back to log in
          </Link>
        </p>
      ) : (
        <p role="alert" className="text-muted-foreground mt-2">
          This reset link is not valid any more: it may have expired or been used already. Ask the
          HanziQuest team for a new one.{" "}
          <Link href="/login" className="text-primary font-bold hover:underline">
            Back to log in
          </Link>
        </p>
      )}
    </>
  );
}
