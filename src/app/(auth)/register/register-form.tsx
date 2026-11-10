"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { registerAction } from "@/features/authentication/actions";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";

export function RegisterForm() {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(undefined);
    startTransition(async () => {
      const result = await registerAction(values);
      if (!result) return;
      if (result.error) setServerError(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof RegisterInput, { message: messages[0] });
      }
    });
  });

  const { errors } = form.formState;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {serverError ? <Alert variant="error">{serverError}</Alert> : null}
      <FormField id="displayName" label="Your name" error={errors.displayName?.message}>
        <Input autoComplete="name" {...form.register("displayName")} />
      </FormField>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
      </FormField>
      <FormField
        id="password"
        label="Password"
        hint="At least 10 characters."
        error={errors.password?.message}
      >
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
