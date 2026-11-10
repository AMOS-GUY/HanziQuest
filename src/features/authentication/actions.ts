"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/lib/auth/auth";
import { prisma } from "@/lib/database/prisma";
import { registerUser } from "@/features/authentication/register";
import { registerLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { loginSchema } from "@/lib/validation/auth";
import { safeRedirectPath } from "@/lib/utilities/safe-redirect";

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function loginAction(input: unknown, callbackUrl?: string): Promise<ActionState> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeRedirectPath(callbackUrl),
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      if (error instanceof CredentialsSignin && error.code === "rate_limited") {
        return { error: "Too many sign-in attempts. Please wait 15 minutes and try again." };
      }
      return { error: "Incorrect email or password." };
    }
    throw error; // includes Next.js redirect on success
  }
}

export async function registerAction(input: unknown): Promise<ActionState> {
  const { ip, userAgent } = await getRequestInfo();
  const limit = registerLimiter.consume(ip);
  if (!limit.allowed) {
    return { error: "Too many accounts created from this network. Please try again later." };
  }

  const result = await registerUser(prisma, input, { ip, userAgent });
  if (!result.ok) {
    if (result.error === "email_taken") {
      return {
        fieldErrors: { email: ["An account with this email already exists. Try logging in."] },
      };
    }
    return { fieldErrors: result.fieldErrors };
  }

  const { password } = input as { password: string };
  try {
    await signIn("credentials", { email: result.email, password, redirectTo: "/home" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Your account was created, but signing in failed. Please log in." };
    }
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
