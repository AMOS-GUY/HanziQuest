import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/features/authentication/actions";
import { ROLE_DEFINITIONS } from "@/lib/permissions/permissions";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const visibleRoles = user.roles.filter((r) => r !== "LEARNER");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-black">Profile</h1>
      <Card>
        <CardTitle className="mb-3">Account</CardTitle>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground font-bold">Name</dt>
          <dd>{user.profile?.displayName ?? user.name}</dd>
          <dt className="text-muted-foreground font-bold">Email</dt>
          <dd className="break-all">{user.email}</dd>
          <dt className="text-muted-foreground font-bold">Daily goal</dt>
          <dd>{user.profile?.dailyGoalXp ?? 30} XP</dd>
          <dt className="text-muted-foreground font-bold">Time zone</dt>
          <dd>{user.profile?.timezone ?? "UTC"}</dd>
          {visibleRoles.length > 0 ? (
            <>
              <dt className="text-muted-foreground font-bold">Roles</dt>
              <dd className="flex flex-wrap gap-1">
                {visibleRoles.map((r) => (
                  <Badge key={r}>{ROLE_DEFINITIONS[r].name}</Badge>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
      </Card>
      <form action={logoutAction}>
        <Button type="submit" variant="secondary">
          <LogOut aria-hidden /> Log out
        </Button>
      </form>
    </div>
  );
}
