/** Only allow same-origin relative paths as post-login destinations (prevents open redirects). */
export function safeRedirectPath(value: unknown, fallback = "/home"): string {
  if (typeof value !== "string" || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(value)) return fallback;
  return value;
}
