// @vitest-environment jsdom
/**
 * "Watch the strokes" in guided practice: the learner can switch between watching and tracing.
 * The two children (Hanzi Writer and the SVG player) are replaced by stand-ins, because they
 * need a real browser; what's tested is the switching and that grading still flows through.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let mounts = 0;
vi.mock("@/components/handwriting/guided-stroke-quiz", () => ({
  GuidedStrokeQuiz: ({ onComplete }: { onComplete: (s: { mistakes: number }) => void }) => {
    mounts += 1;
    return (
      <button type="button" onClick={() => onComplete({ mistakes: 1 })}>
        quiz-{mounts}
      </button>
    );
  },
}));
vi.mock("@/components/characters/stroke-order-player", () => ({
  StrokeOrderPlayer: ({ hanzi }: { hanzi: string }) => <p>player {hanzi}</p>,
}));

import { GuidedPractice } from "@/components/handwriting/guided-practice";

const data = { strokes: ["M 0 0"], medians: [[[0, 0]]] };

afterEach(() => {
  cleanup();
  mounts = 0;
});

describe("GuidedPractice", () => {
  it("starts in tracing mode, as before", () => {
    render(<GuidedPractice hanzi="人" data={data} onComplete={() => {}} />);
    expect(screen.getByRole("button", { name: /quiz-/ })).toBeTruthy();
    expect(screen.queryByText("player 人")).toBeNull();
    expect(screen.getByRole("button", { name: /Trace it/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Watch the strokes/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("switches to watching and back, with a fresh trace each time", () => {
    render(<GuidedPractice hanzi="人" data={data} onComplete={() => {}} />);
    expect(screen.getByText("quiz-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Watch the strokes/ }));
    expect(screen.getByText("player 人")).toBeTruthy();
    expect(screen.queryByText(/quiz-/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Watch the strokes/ }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /I'm ready to trace/ }));
    expect(screen.queryByText("player 人")).toBeNull();
    expect(screen.getByText("quiz-2")).toBeTruthy();

    // "Trace it" while already tracing doesn't restart the trace.
    fireEvent.click(screen.getByRole("button", { name: /Trace it/ }));
    expect(screen.getByText("quiz-2")).toBeTruthy();
  });

  it("passes the tracing result through unchanged", () => {
    const onComplete = vi.fn();
    render(<GuidedPractice hanzi="人" data={data} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /Watch the strokes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Trace it/ }));
    fireEvent.click(screen.getByRole("button", { name: /quiz-/ }));
    expect(onComplete).toHaveBeenCalledWith({ mistakes: 1 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
