import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";
import { requirePagePermission } from "@/lib/auth/session";
import type { Permission } from "@/lib/permissions/permissions";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · HanziQuest Admin" },
  robots: { index: false },
};

const NAV: (AdminNavItem & { permission: Permission })[] = [
  { href: "/admin", label: "Overview", icon: "layout-dashboard", permission: "admin:access" },
  {
    href: "/admin/curricula",
    label: "Curricula",
    icon: "library",
    permission: "curriculum:read",
  },
  { href: "/admin/lessons", label: "Lessons", icon: "book-open", permission: "curriculum:read" },
  {
    href: "/admin/characters",
    label: "Characters",
    icon: "languages",
    permission: "curriculum:read",
  },
  {
    href: "/admin/vocabulary",
    label: "Vocabulary",
    icon: "book-a",
    permission: "curriculum:read",
  },
  { href: "/admin/import", label: "Import", icon: "upload", permission: "content:import" },
  {
    href: "/admin/handwriting",
    label: "Handwriting lab",
    icon: "pen-line",
    permission: "handwriting:validate",
  },
  { href: "/admin/users", label: "Users", icon: "users", permission: "users:read" },
  { href: "/admin/audit-logs", label: "Audit log", icon: "scroll-text", permission: "audit:read" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePagePermission("admin:access");
  const items: AdminNavItem[] = NAV.filter((item) => user.permissions.has(item.permission)).map(
    (item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
    }),
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-border bg-surface border-b-2 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-r-2 md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4">
          <Logo size={32} />
          <span className="font-black">
            HanziQuest <span className="text-primary">Admin</span>
          </span>
        </div>
        <AdminNav items={items} />
        <Link
          href="/home"
          className="text-muted-foreground hover:text-foreground hidden items-center gap-2 px-6 py-4 text-sm font-bold md:flex"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to learning
        </Link>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
