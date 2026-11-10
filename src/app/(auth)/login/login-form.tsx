"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { loginAction } from "@/features/authentication/actions";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(undefined);
    startTransition(async () => {
      const result = await loginAction(values, callbackUrl);
      if (result?.error) setServerError(result.error);
    });
  });

  const { errors } = form.formState;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {serverError ? <Alert variant="error">{serverError}</Alert> : null}
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register("password")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
