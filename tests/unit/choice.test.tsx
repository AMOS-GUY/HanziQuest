// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Choice } from "@/components/ui/choice";

afterEach(cleanup);

function Group({ initial }: { initial?: number }) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <div role="radiogroup" aria-label="Pace">
      {["Relaxed", "Regular", "Intense"].map((label, i) => (
        <Choice key={label} label={label} selected={value === i} onSelect={() => setValue(i)}>
          {label}
        </Choice>
      ))}
    </div>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });
const tabStops = () => screen.getAllByRole("radio").filter((r) => r.tabIndex === 0);

describe("Choice as a radio group (M19 F-03)", () => {
  it("is one tab stop: the first option when nothing is selected", () => {
    render(<Group />);
    expect(tabStops()).toEqual([radio("Relaxed")]);
  });

  it("is one tab stop: the selected option", () => {
    render(<Group initial={2} />);
    expect(tabStops()).toEqual([radio("Intense")]);
  });

  it("arrow keys, Home and End move focus and select, wrapping around", () => {
    render(<Group initial={0} />);
    radio("Relaxed").focus();
    fireEvent.keyDown(radio("Relaxed"), { key: "ArrowDown" });
    expect(radio("Regular").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("Regular"));
    expect(tabStops()).toEqual([radio("Regular")]);

    fireEvent.keyDown(radio("Regular"), { key: "End" });
    expect(radio("Intense").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Intense"), { key: "ArrowRight" });
    expect(radio("Relaxed").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Relaxed"), { key: "ArrowUp" });
    expect(radio("Intense").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Intense"), { key: "Home" });
    expect(radio("Relaxed").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("Relaxed"));
  });

  it("other keys do nothing; clicking still selects", () => {
    render(<Group />);
    fireEvent.keyDown(radio("Relaxed"), { key: "a" });
    expect(
      screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    fireEvent.click(radio("Intense"));
    expect(radio("Intense").getAttribute("aria-checked")).toBe("true");
  });

  it("checkboxes stay independent tab stops and ignore arrow keys", () => {
    function Boxes() {
      const [on, setOn] = useState<string[]>([]);
      return (
        <div>
          {["Read", "Write"].map((l) => (
            <Choice
              key={l}
              label={l}
              role="checkbox"
              selected={on.includes(l)}
              onSelect={() => setOn((o) => (o.includes(l) ? o.filter((x) => x !== l) : [...o, l]))}
            >
              {l}
            </Choice>
          ))}
        </div>
      );
    }
    render(<Boxes />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.every((b) => b.tabIndex === 0)).toBe(true);
    fireEvent.keyDown(boxes[0]!, { key: "ArrowDown" });
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
  });
});
