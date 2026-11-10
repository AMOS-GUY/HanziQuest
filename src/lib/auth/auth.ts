import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/database/prisma";
import { verifyPasswordConstantTime } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validation/auth";
import { loginLimiter } from "@/lib/security/rate-limit";
import { ipFromHeaders } from "@/lib/security/request-info";
import { recordAudit } from "@/lib/audit";

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Auth.js configuration.
 * - Credentials (email + password) with bcrypt hashes; JWT session strategy (required for credentials).
 * - The JWT carries only the user id. Roles and account status are loaded from the database on
 *   every server-side check (see session.ts), so role changes and suspensions apply immediately.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const ip = ipFromHeaders(request.headers);
        const limit = loginLimiter.consume(`${email}|${ip}`);
        if (!limit.allowed) throw new RateLimitedSignin();

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await verifyPasswordConstantTime(password, user?.passwordHash);
        if (!user || !valid || user.status !== "ACTIVE") return null;

        loginLimiter.reset(`${email}|${ip}`);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await recordAudit(prisma, {
          actorId: user.id,
          action: "user.login",
          entityType: "User",
          entityId: user.id,
          ipAddress: ip,
          userAgent: request.headers.get("user-agent"),
        });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
