import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-black">Welcome back</h1>
      <p className="text-muted-foreground mb-6">Log in to continue your quest.</p>
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
