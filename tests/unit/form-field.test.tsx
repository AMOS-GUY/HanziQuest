// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormField } from "@/components/forms/form-field";

afterEach(cleanup);

/** Every id in aria-describedby must point at an element that is on the page. */
function describedTexts(input: HTMLElement) {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? null);
}

describe("FormField", () => {
  it("describes the field with its hint when there is no error", () => {
    render(
      <FormField id="password" label="Password" hint="At least 10 characters">
        <input />
      </FormField>,
    );
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(describedTexts(input)).toEqual(["At least 10 characters"]);
  });

  it("with an error, references only the error (the hint isn't rendered)", () => {
    render(
      <FormField id="password" label="Password" hint="At least 10 characters" error="Too short">
        <input />
      </FormField>,
    );
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedTexts(input)).toEqual(["Too short"]);
  });

  it("has no aria-describedby without hint or error", () => {
    render(
      <FormField id="name" label="Name">
        <input />
      </FormField>,
    );
    expect(screen.getByLabelText("Name").hasAttribute("aria-describedby")).toBe(false);
  });
});
