import type { Metadata } from "next";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminForm } from "@/components/admin/admin-form";
import { SignOutButton } from "@/components/offline/sign-out-button";
import { OfflineDataCard } from "@/components/offline/offline-data-card";
import { requireUser } from "@/lib/auth/session";
import { ROLE_DEFINITIONS } from "@/lib/permissions/permissions";
import { DAILY_GOAL_OPTIONS } from "@/features/onboarding/schema";
import {
  changePasswordAction,
  deleteAccountAction,
  updateProfileAction,
} from "@/features/account/actions";

export const metadata: Metadata = { title: "Profile" };

const TIME_ZONES = Intl.supportedValuesOf("timeZone");

export default async function ProfilePage() {
  const user = await requireUser();
  const visibleRoles = user.roles.filter((r) => r !== "LEARNER");
  const timezone = user.profile?.timezone ?? "UTC";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Profile</h1>
        <p className="text-muted-foreground break-all">{user.email}</p>
        {visibleRoles.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleRoles.map((r) => (
              <Badge key={r}>{ROLE_DEFINITIONS[r].name}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      <Card>
        <CardTitle className="mb-4">Learning settings</CardTitle>
        <AdminForm
          action={updateProfileAction}
          fields={[
            {
              name: "displayName",
              label: "Name",
              defaultValue: user.profile?.displayName ?? user.name ?? "",
              required: true,
              autoComplete: "nickname",
            },
            {
              name: "dailyGoalXp",
              label: "Daily goal",
              type: "select",
              defaultValue: String(user.profile?.dailyGoalXp ?? 30),
              options: DAILY_GOAL_OPTIONS.map((o) => ({
                value: String(o.value),
                label: `${o.label}: ${o.value} XP (${o.detail})`,
              })),
            },
            {
              name: "timezone",
              label: "Time zone",
              type: "select",
              defaultValue: timezone,
              wide: true,
              help: "Days, streaks and your daily goal follow this time zone.",
              options: (TIME_ZONES.includes(timezone) ? TIME_ZONES : [timezone, ...TIME_ZONES]).map(
                (tz) => ({ value: tz, label: tz.replaceAll("_", " ") }),
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <CardTitle>Offline on this device</CardTitle>
        <CardDescription className="mb-3">
          Downloaded lessons are removed when you log out. Practice that hasn&apos;t synced stays
          with your account on this device only.
        </CardDescription>
        <OfflineDataCard userId={user.id} />
      </Card>

      <Card>
        <CardTitle>Change password</CardTitle>
        <CardDescription className="mb-4">
          You&apos;ll be signed out on every device and asked to log in again.
        </CardDescription>
        <AdminForm
          action={changePasswordAction}
          submitLabel="Change password"
          fields={[
            {
              name: "currentPassword",
              label: "Current password",
              type: "password",
              required: true,
              autoComplete: "current-password",
              wide: true,
            },
            {
              name: "newPassword",
              label: "New password",
              type: "password",
              required: true,
              autoComplete: "new-password",
              help: "At least 10 characters",
            },
            {
              name: "confirmPassword",
              label: "Repeat new password",
              type: "password",
              required: true,
              autoComplete: "new-password",
            },
          ]}
        />
      </Card>

      <div>
        <SignOutButton userId={user.id} />
      </div>

      <Card className="border-danger/40">
        <details>
          <summary className="text-danger cursor-pointer font-extrabold">Delete my account</summary>
          <p className="text-muted-foreground mt-3 mb-4 text-sm">
            This permanently deletes your account, progress, XP and practice history. It can&apos;t
            be undone.
          </p>
          <AdminForm
            action={deleteAccountAction}
            submitLabel="Delete my account permanently"
            fields={[
              {
                name: "password",
                label: "Password",
                type: "password",
                required: true,
                autoComplete: "current-password",
              },
              { name: "confirm", label: "Type DELETE to confirm", required: true },
            ]}
          />
        </details>
      </Card>
    </div>
  );
}
