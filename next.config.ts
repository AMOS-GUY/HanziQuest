import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. 'unsafe-inline' for styles is required by Next.js style injection and
 * Framer Motion; scripts allow 'unsafe-inline' because App Router bootstraps with inline scripts
 * (a nonce-based policy is a planned hardening step — see docs/SECURITY.md).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "pg", "hanzi-writer-data"],
  experimental: {
    // Curriculum imports are uploaded through a server action (validated, max 2 MB of JSON).
    serverActions: { bodySizeLimit: "3mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must always be revalidated so updates reach learners promptly.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, max-age=0" }] },
    ];
  },
};

export default nextConfig;
