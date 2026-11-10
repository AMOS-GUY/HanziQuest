import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * Static pages the service worker keeps for use without a connection. They read only what this
 * browser stored (downloaded lessons and queued practice) and need no server session.
 */
export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-10">
      {children}
    </main>
  );
}
