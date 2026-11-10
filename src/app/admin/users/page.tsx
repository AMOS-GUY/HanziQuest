import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/admin/pager";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { ROLE_DEFINITIONS } from "@/lib/permissions/permissions";
import { DEFAULT_PAGE_SIZE, pageCount, parsePage } from "@/lib/utilities/pagination";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Users" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  await requirePagePermission("users:read");
  const params = await searchParams;
  const page = parsePage(params.page);
  const q = (params.q ?? "").trim().slice(0, 100);

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
      // Never select passwordHash or other secrets here.
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-3xl font-black">Users</h1>
      <form className="mb-4 flex max-w-md gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search by email or name
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="Search by email or name" />
        <Button type="submit" variant="secondary" size="icon" aria-label="Search">
          <Search aria-hidden />
        </Button>
      </form>
      {users.length === 0 ? (
        <p className="text-muted-foreground">No users match.</p>
      ) : (
        <div className="border-border bg-surface overflow-x-auto rounded-[var(--radius-card)] border-2">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-border text-muted-foreground border-b-2">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Roles</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Joined</th>
                <th className="px-4 py-2">Last login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="text-primary font-bold hover:underline"
                    >
                      {u.name ?? "(no name)"}
                    </Link>
                    <div className="text-muted-foreground text-xs">{u.email}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {u.roles
                        .filter((r) => r.role.key !== "LEARNER")
                        .map((r) => (
                          <Badge key={r.role.key}>{ROLE_DEFINITIONS[r.role.key].name}</Badge>
                        ))}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={u.status === "ACTIVE" ? "muted" : "danger"}>{u.status}</Badge>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {u.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {u.lastLoginAt
                      ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        pages={pageCount(total)}
        basePath="/admin/users"
        params={{ q: q || undefined }}
      />
    </div>
  );
}
