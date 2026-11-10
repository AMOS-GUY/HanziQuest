import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { safeRedirectPath } from "@/lib/utilities/safe-redirect";
import { parsePage, pageCount } from "@/lib/utilities/pagination";

describe("registerSchema", () => {
  it("normalises email to lowercase and trims the name", () => {
    const parsed = registerSchema.parse({
      displayName: "  Mei  ",
      email: "  Mei@Example.COM ",
      password: "a-long-password",
    });
    expect(parsed.email).toBe("mei@example.com");
    expect(parsed.displayName).toBe("Mei");
  });

  it("rejects short passwords, bad emails and empty names", () => {
    const result = registerSchema.safeParse({ displayName: " ", email: "nope", password: "short" });
    expect(result.success).toBe(false);
    const fields = result.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["displayName", "email", "password"]));
  });

  it("rejects passwords longer than 128 characters", () => {
    expect(
      registerSchema.safeParse({ displayName: "A", email: "a@b.co", password: "x".repeat(129) })
        .success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("does not reveal password policy on sign-in", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/learn?x=1", "/learn?x=1"],
    ["https://evil.example", "/home"],
    ["//evil.example", "/home"],
    ["/\\evil.example", "/home"],
    ["javascript:alert(1)", "/home"],
    ["/ok\r\nSet-Cookie: x", "/home"],
    [undefined, "/home"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("pagination", () => {
  it("parses and clamps page numbers", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("999999999")).toBe(10_000);
    expect(parsePage(["2", "5"])).toBe(2);
  });

  it("computes page counts", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
  });
});
