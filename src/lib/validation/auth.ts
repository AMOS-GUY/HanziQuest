import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254, "Email address is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(50, "Use at most 50 characters");

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply length rules on sign-in: only check presence, so errors never reveal password policy details.
  password: z.string().min(1, "Enter your password").max(128),
});

export const registerSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** Recorded with the terms version when true. Required by the sign-up form and action. */
  acceptTerms: z.boolean().optional(),
});

/** What the public sign-up form and action require: the beta terms must be accepted. */
export const registerFormSchema = registerSchema.extend({
  acceptTerms: z.literal(true, "Please accept the beta terms and privacy notice"),
});
export type RegisterFormInput = z.infer<typeof registerFormSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
