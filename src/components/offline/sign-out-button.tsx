"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { logoutAction } from "@/features/authentication/actions";
import { pendingCount, prepareSignOut } from "@/features/offline/client/account";

/**
 * Signs out after clearing this account's offline data. If practice results are still waiting
 * to sync (e.g. offline), the learner chooses to keep them for next time or delete them.
 */
export function SignOutButton({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  const [waiting, setWaiting] = useState(0);

  const signOut = (discardPending: boolean) =>
    start(async () => {
      await prepareSignOut(userId, { discardPending });
      await logoutAction();
    });

  const begin = () =>
    start(async () => {
      const count = await pendingCount(userId).catch(() => 0);
      if (count > 0 && !navigator.onLine) {
        setWaiting(count);
        return;
      }
      await prepareSignOut(userId);
      await logoutAction();
    });

  if (waiting > 0) {
    return (
      <Alert className="flex flex-col gap-3">
        <p>
          {waiting} practice result{waiting === 1 ? " hasn't" : "s haven't"} synced yet because
          you&apos;re offline. Keep them on this device to sync next time you sign in here, or
          delete them. Other accounts can never see or upload them.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => signOut(false)}>
            Keep and sign out
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => signOut(true)}>
            Delete and sign out
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setWaiting(0)}>
            Cancel
          </Button>
        </div>
      </Alert>
    );
  }
  return (
    <Button type="button" variant="secondary" disabled={pending} onClick={begin}>
      <LogOut aria-hidden /> {pending ? "Signing out…" : "Log out"}
    </Button>
  );
}
