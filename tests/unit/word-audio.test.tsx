// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WordAudio } from "@/components/vocabulary/word-audio";

afterEach(cleanup);

describe("WordAudio", () => {
  it("renders nothing when a word has no recording (no fake audio)", () => {
    for (const src of [null, undefined, ""]) {
      const { container } = render(<WordAudio src={src} word="你好" />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("renders a labelled native player that doesn't preload", () => {
    const { container } = render(<WordAudio src="/audio/nihao.mp3" word="你好" />);
    const audio = container.querySelector("audio")!;
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toBe("/audio/nihao.mp3");
    expect(audio.getAttribute("preload")).toBe("none");
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(screen.getByLabelText("Pronunciation of 你好")).toBe(audio);
  });
});
