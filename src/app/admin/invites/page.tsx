import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { inviteStatus, registrationMode } from "@/features/invites/invites";
import { CreateInvite, RevokeInvite } from "./invite-controls";

export const metadata = { title: "Beta invites" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT = {
  active: "default",
  "used up": "muted",
  expired: "muted",
  revoked: "danger",
} as const;

export default async function InvitesPage() {
  await requirePagePermission("invites:manage");
  const mode = registrationMode();
  const invites = await prisma.betaInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const origin = process.env.AUTH_URL?.replace(/\/$/, "") ?? "";
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-3xl font-black">Beta invites</h1>
        <p className="text-muted-foreground text-sm">
          Registration is <strong>{mode === "invite" ? "invite-only" : "open to anyone"}</strong> (
          <code>REGISTRATION_MODE={mode}</code>).{" "}
          {mode === "open"
            ? "Invites are not required while registration is open."
            : "New accounts need a valid code."}
        </p>
      </div>

      <Card>
        <CardTitle className="mb-1">New invite</CardTitle>
        <CardDescription className="mb-4">
          The code is shown once and only its hash is stored. Share it with the testers it is for;
          it stops working when it expires, is used up or is revoked.
        </CardDescription>
        <CreateInvite origin={origin} />
      </Card>

      <Card>
        <CardTitle className="mb-3">Invites</CardTitle>
        {invites.length === 0 ? (
          <p className="text-muted-foreground">No invites yet.</p>
        ) : (
          <div
            role="region"
            aria-label="Invites (scrolls sideways)"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">For</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Used</th>
                  <th className="py-2 pr-4">Expires</th>
                  <th className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const status = inviteStatus(invite, now);
                  return (
                    <tr key={invite.id} className="border-border border-t">
                      <td className="py-2 pr-4 font-semibold">{invite.label}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {invite.uses} / {invite.maxUses}
                      </td>
                      <td className="py-2 pr-4">
                        {invite.expiresAt?.toISOString().slice(0, 10) ?? "never"}
                      </td>
                      <td className="py-2 text-right">
                        {status === "active" ? <RevokeInvite id={invite.id} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
