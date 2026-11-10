import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-1 text-3xl font-black">Start your quest</h1>
      <p className="text-muted-foreground mb-6">Create a free account to save your progress.</p>
      <RegisterForm />
      <p className="text-muted-foreground mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-primary font-bold hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
