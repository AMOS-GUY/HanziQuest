"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { setUserRoleAction } from "@/features/administration/actions";

interface RoleOption {
  key: "SUPER_ADMIN" | "CURRICULUM_EDITOR" | "MODERATOR" | "ANALYST" | "SUPPORT";
  name: string;
  description: string;
  granted: boolean;
  locked: boolean;
}

export function RoleEditor({ userId, roles }: { userId: string; roles: RoleOption[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="sr-only">Assigned roles</legend>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {roles.map((role) => (
        <label key={role.key} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--primary)]"
            defaultChecked={role.granted}
            disabled={role.locked}
            onChange={(event) => {
              const grant = event.currentTarget.checked;
              const input = event.currentTarget;
              startTransition(async () => {
                setError(undefined);
                const result = await setUserRoleAction({ userId, role: role.key, grant });
                if (!result.ok) {
                  input.checked = !grant;
                  setError(result.message);
                }
              });
            }}
          />
          <span>
            <span className="block font-bold">{role.name}</span>
            <span className="text-muted-foreground block text-xs">{role.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
