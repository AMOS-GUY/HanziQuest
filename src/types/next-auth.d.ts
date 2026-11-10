import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
    /** When the session token was first issued (seconds since epoch). */
    issuedAt?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    issuedAt?: number;
  }
}
