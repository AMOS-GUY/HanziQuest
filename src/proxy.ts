import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/database/prisma";
import { ADMIN_ROLES } from "@/lib/permissions/permissions";

/**
 * Gate for the admin area, before any admin page or metadata is rendered.
 * - Signed out → login.
 * - Signed in without an admin role (or suspended, or with a revoked session) → a plain 404,
 *   so the response doesn't reveal admin page titles.
 * Pages and actions still check their specific permissions; this is defence in depth.
 */
export default auth(async (request) => {
  const userId = request.auth?.user?.id;
  if (!userId) {
    const login = new URL("/login", request.nextUrl);
    login.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      credentialsChangedAt: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  const revoked =
    user?.credentialsChangedAt &&
    (request.auth?.issuedAt ?? 0) * 1000 < user.credentialsChangedAt.getTime();
  const isStaff = user?.roles.some((r) => ADMIN_ROLES.includes(r.role.key));
  if (!user || user.status !== "ACTIVE" || revoked || !isStaff) {
    return NextResponse.rewrite(new URL("/not-found-404", request.nextUrl), { status: 404 });
  }
  return NextResponse.next();
});

export const config = { matcher: ["/admin", "/admin/:path*"] };
