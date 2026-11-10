import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo size={72} />
      <h1 className="text-3xl font-black">Page not found</h1>
      <p className="text-muted-foreground">
        This path doesn&apos;t lead anywhere. Let&apos;s get you back on track.
      </p>
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
