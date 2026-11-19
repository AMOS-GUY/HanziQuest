import { describe, expect, it } from "vitest";
import { issuedBeforeCredentialsChange } from "@/lib/auth/issued";

const changed = new Date("2026-11-19T12:00:00.700Z");

describe("sessions issued before a credentials change are revoked", () => {
  it("compares in milliseconds: a sign-in later in the same second stays valid", () => {
    expect(
      issuedBeforeCredentialsChange(changed, {
        issuedAt: 1_795_000_000,
        issuedAtMs: changed.getTime() + 200,
      }),
    ).toBe(false);
    expect(issuedBeforeCredentialsChange(changed, { issuedAtMs: changed.getTime() - 1 })).toBe(
      true,
    );
  });

  it("older tokens (seconds only) keep the previous rule", () => {
    const sec = Math.floor(changed.getTime() / 1000);
    expect(issuedBeforeCredentialsChange(changed, { issuedAt: sec })).toBe(true);
    expect(issuedBeforeCredentialsChange(changed, { issuedAt: sec + 1 })).toBe(false);
  });

  it("no change, no revocation; a token without any time is revoked once credentials changed", () => {
    expect(issuedBeforeCredentialsChange(null, {})).toBe(false);
    expect(issuedBeforeCredentialsChange(changed, {})).toBe(true);
    expect(issuedBeforeCredentialsChange(changed, null)).toBe(true);
  });
});
