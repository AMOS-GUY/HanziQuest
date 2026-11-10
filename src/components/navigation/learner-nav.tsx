"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { Logo, Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/utilities/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Review and Progress join this list when those screens ship (milestone M3).
const ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/learn", label: "Learn", icon: Map },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function LearnerSidebar({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="border-border sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r-2 px-4 py-6 md:flex">
      <Link href="/home" className="mb-8 flex items-center gap-2 px-2" aria-label="HanziQuest home">
        <Logo size={36} />
        <Wordmark />
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:bg-surface-muted flex items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition-colors",
              isActive(pathname, href) && "bg-accent text-accent-foreground hover:bg-accent",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        ))}
        {showAdmin ? (
          <Link
            href="/admin"
            className="text-muted-foreground hover:bg-surface-muted mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 font-bold"
          >
            <ShieldCheck className="size-5" aria-hidden />
            Admin
          </Link>
        ) : null}
      </nav>
    </aside>
  );
}

export function LearnerBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="border-border bg-surface fixed inset-x-0 bottom-0 z-40 border-t-2 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-md justify-around">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cn(
                "text-muted-foreground flex min-w-16 flex-col items-center gap-0.5 px-3 py-2 text-xs font-bold",
                isActive(pathname, href) && "text-primary",
              )}
            >
              <Icon className="size-6" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
