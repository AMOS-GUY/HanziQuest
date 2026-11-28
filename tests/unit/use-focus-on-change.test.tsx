// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusOnChange } from "@/components/ui/use-focus-on-change";

afterEach(cleanup);

function Steps() {
  const [step, setStep] = useState(0);
  const heading = useFocusOnChange<HTMLHeadingElement>(step);
  return (
    <div>
      <h1 ref={heading} tabIndex={-1}>
        Question {step + 1}
      </h1>
      <button type="button" onClick={() => setStep((s) => s + 1)}>
        Continue
      </button>
      <button type="button" onClick={() => setStep((s) => s)}>
        Same
      </button>
    </div>
  );
}

describe("useFocusOnChange (M19 F-04)", () => {
  it("doesn't take focus on the first render", () => {
    render(<Steps />);
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the new step's heading when the step changes", () => {
    render(<Steps />);
    const next = screen.getByRole("button", { name: "Continue" });
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 2" }));
  });

  it("focuses the new heading when each step mounts its own (as with exit animations)", () => {
    function Remounting() {
      const [step, setStep] = useState(0);
      const heading = useFocusOnChange<HTMLHeadingElement>(step);
      return (
        <div>
          <section key={step}>
            <h1 ref={heading} tabIndex={-1}>
              Step {step + 1}
            </h1>
          </section>
          <button type="button" onClick={() => setStep((s) => s + 1)}>
            Continue
          </button>
        </div>
      );
    }
    render(<Remounting />);
    const next = screen.getByRole("button", { name: "Continue" });
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Step 2" }));
  });

  it("leaves focus alone when the key doesn't change", () => {
    render(<Steps />);
    const same = screen.getByRole("button", { name: "Same" });
    same.focus();
    fireEvent.click(same);
    expect(document.activeElement).toBe(same);
  });
});
