import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { ROLE_DEFINITIONS } from "@/lib/permissions/permissions";
import type { RoleKey } from "@/generated/prisma/enums";
import { RoleEditor } from "./role-editor";
import { AdminForm } from "@/components/admin/admin-form";
import { setUserStatusAction } from "@/features/account/actions";
import { RESET_TTL_HOURS } from "@/features/account/password-reset";
import { PasswordResetLink } from "./password-reset";

export const metadata = { title: "User" };

const ASSIGNABLE = [
  "SUPER_ADMIN",
  "CURRICULUM_EDITOR",
  "MODERATOR",
  "ANALYST",
  "SUPPORT",
] as const satisfies readonly RoleKey[];

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePagePermission("users:read");
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      profile: {
        select: {
          displayName: true,
          declaredHskLevel: true,
          timezone: true,
          onboardingCompletedAt: true,
        },
      },
      roles: { select: { role: { select: { key: true } } } },
      _count: { select: { attempts: true } },
    },
  });
  if (!user) notFound();

  const roles = user.roles.map((r) => r.role.key);
  const canManage = viewer.permissions.has("users:manage-roles");
  const viewerIsSuper = viewer.roles.includes("SUPER_ADMIN");

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link href="/admin/users" className="text-primary flex items-center gap-1 text-sm font-bold">
        <ArrowLeft className="size-4" aria-hidden /> All users
      </Link>
      <h1 className="text-3xl font-black">{user.name ?? user.email}</h1>
      <Card>
        <CardTitle className="mb-3">Account</CardTitle>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground font-bold">Email</dt>
          <dd className="break-all">{user.email}</dd>
          <dt className="text-muted-foreground font-bold">Status</dt>
          <dd>
            <Badge variant={user.status === "ACTIVE" ? "muted" : "danger"}>{user.status}</Badge>
          </dd>
          <dt className="text-muted-foreground font-bold">Joined</dt>
          <dd>{user.createdAt.toISOString().slice(0, 10)}</dd>
          <dt className="text-muted-foreground font-bold">Declared HSK level</dt>
          <dd>{user.profile?.declaredHskLevel ?? "—"}</dd>
          <dt className="text-muted-foreground font-bold">Time zone</dt>
          <dd>{user.profile?.timezone ?? "—"}</dd>
          <dt className="text-muted-foreground font-bold">Exercise attempts</dt>
          <dd>{user._count.attempts}</dd>
        </dl>
      </Card>
      {viewer.permissions.has("users:moderate") && viewer.id !== user.id ? (
        <Card>
          <CardTitle className="mb-1">Moderation</CardTitle>
          <p className="text-muted-foreground mb-4 text-sm">
            A suspended account is signed out on its next request and can&apos;t sign in until it is
            reactivated. Every change is written to the audit log.
          </p>
          <AdminForm
            action={setUserStatusAction.bind(null, user.id)}
            submitLabel="Apply"
            fields={[
              {
                name: "status",
                label: "Status",
                type: "select",
                defaultValue: user.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
                options: [
                  { value: "SUSPENDED", label: "Suspend" },
                  { value: "ACTIVE", label: "Reactivate" },
                ],
              },
              { name: "reason", label: "Reason", required: true },
            ]}
          />
        </Card>
      ) : null}
      {viewer.permissions.has("users:moderate") &&
      viewer.id !== user.id &&
      user.status === "ACTIVE" ? (
        <Card>
          <CardTitle className="mb-1">Password reset</CardTitle>
          <p className="text-muted-foreground mb-4 text-sm">
            For a learner who has forgotten their password. The link works once, for{" "}
            {RESET_TTL_HOURS} hours, and signs them out everywhere when used. Send it only to the
            email address on this account, never to an address or chat the requester gives you
            (SECURITY.md). Staff accounts need a Super Admin.
          </p>
          <PasswordResetLink userId={user.id} />
        </Card>
      ) : null}
      <Card>
        <CardTitle className="mb-3">Roles</CardTitle>
        {canManage ? (
          <RoleEditor
            userId={user.id}
            roles={ASSIGNABLE.map((key) => ({
              key,
              name: ROLE_DEFINITIONS[key].name,
              description: ROLE_DEFINITIONS[key].description,
              granted: roles.includes(key),
              locked: key === "SUPER_ADMIN" && !viewerIsSuper,
            }))}
          />
        ) : (
          <div className="flex flex-wrap gap-1">
            {roles.map((r) => (
              <Badge key={r}>{ROLE_DEFINITIONS[r].name}</Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
