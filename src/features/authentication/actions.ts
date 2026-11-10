"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/lib/auth/auth";
import { prisma } from "@/lib/database/prisma";
import { registerUser } from "@/features/authentication/register";
import { registrationMode } from "@/features/invites/invites";
import { registerLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { loginSchema, registerFormSchema } from "@/lib/validation/auth";
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
  const limit = await registerLimiter.consume(ip);
  if (!limit.allowed) {
    return { error: "Too many accounts created from this network. Please try again later." };
  }

  // The beta terms must be accepted; enforced here, not only in the browser.
  const terms = registerFormSchema.pick({ acceptTerms: true }).safeParse(input);
  if (!terms.success)
    return { fieldErrors: { acceptTerms: ["Please accept the beta terms and privacy notice"] } };

  const result = await registerUser(prisma, input, {
    ip,
    userAgent,
    requireInvite: registrationMode() === "invite",
  });
  if (!result.ok) {
    if (result.error === "invite_invalid") {
      return {
        fieldErrors: {
          inviteCode: [
            "This invite code is not valid, has expired or has been used up. Check it or ask for a new one.",
          ],
        },
      };
    }
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
