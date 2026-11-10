import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; changed?: string }>;
}) {
  const { callbackUrl, changed } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-black">Welcome back</h1>
      <p className="text-muted-foreground mb-6">Log in to continue your quest.</p>
      {changed ? (
        <p
          role="status"
          className="bg-accent text-accent-foreground mb-4 rounded-xl px-4 py-3 text-sm font-bold"
        >
          Password changed. Log in with your new password.
        </p>
      ) : null}
      <LoginForm callbackUrl={callbackUrl} />
      <p className="text-muted-foreground mt-6 text-center text-sm">
        New to HanziQuest?{" "}
        <Link href="/register" className="text-primary font-bold hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
