"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookA,
  BookOpen,
  Languages,
  LayoutDashboard,
  Library,
  MessageSquare,
  PenLine,
  ScrollText,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utilities/cn";

const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "book-open": BookOpen,
  languages: Languages,
  users: Users,
  "scroll-text": ScrollText,
  library: Library,
  "book-a": BookA,
  upload: Upload,
  "pen-line": PenLine,
  message: MessageSquare,
};

export interface AdminNavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin"
      className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible"
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:bg-surface-muted flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold",
              active && "bg-accent text-accent-foreground hover:bg-accent",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
