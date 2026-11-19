/**
 * Was this session issued before the account's credentials last changed (password change or
 * reset)? Such sessions are revoked.
 *
 * Sessions record their issue time in milliseconds (`issuedAtMs`). Older tokens only have
 * `issuedAt` in whole seconds; comparing those against a millisecond change time revoked a
 * session signed in during the same second as the change (seen as a flaky e2e test). They keep
 * the old comparison until they expire.
 */
export function issuedBeforeCredentialsChange(
  credentialsChangedAt: Date | null | undefined,
  token: { issuedAt?: number; issuedAtMs?: number } | null | undefined,
): boolean {
  if (!credentialsChangedAt) return false;
  const issuedMs =
    typeof token?.issuedAtMs === "number" ? token.issuedAtMs : (token?.issuedAt ?? 0) * 1000;
  return issuedMs < credentialsChangedAt.getTime();
}
