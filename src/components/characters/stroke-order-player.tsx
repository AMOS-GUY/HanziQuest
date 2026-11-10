"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CharacterStrokeJson } from "@/features/handwriting/reference-store";
import { MMAH_TRANSFORM, medianLength, medianPath } from "./stroke-geometry";

const MS_PER_UNIT = 0.9; // animation speed in ms per Make Me a Hanzi unit of median length
const MIN_STROKE_MS = 350;
const PAUSE_BETWEEN_MS = 180;

/**
 * Stroke-order player: animates strokes in canonical order with play/pause, previous/next,
 * replay and a live "stroke n of m" announcement. Uses Make Me a Hanzi data (via hanzi-writer-data);
 * each stroke is revealed by drawing its median through a clip of the stroke outline.
 */
export function StrokeOrderPlayer({
  hanzi,
  data,
  autoPlay = true,
}: {
  hanzi: string;
  data: CharacterStrokeJson;
  autoPlay?: boolean;
}) {
  const total = data.strokes.length;
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(autoPlay ? 0 : total); // strokes fully drawn
  const [partial, setPartial] = useState(0); // 0–1 progress of stroke `shown` while playing
  const [playRequested, setPlaying] = useState(autoPlay);
  // Playback stops by itself once every stroke is shown.
  const playing = playRequested && shown < total;
  const frame = useRef<number | null>(null);
  const clipBase = useId().replace(/:/g, "");

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (reduceMotion) {
      const timer = window.setTimeout(() => setShown((s) => s + 1), 600);
      return () => window.clearTimeout(timer);
    }
    const duration = Math.max(MIN_STROKE_MS, medianLength(data.medians[shown]!) * MS_PER_UNIT);
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      if (elapsed < duration) {
        setPartial(elapsed / duration);
        frame.current = requestAnimationFrame(tick);
      } else if (elapsed < duration + PAUSE_BETWEEN_MS) {
        setPartial(1);
        frame.current = requestAnimationFrame(tick);
      } else {
        setPartial(0);
        setShown((s) => s + 1);
      }
    };
    frame.current = requestAnimationFrame(tick);
    return stop;
  }, [playing, shown, total, data.medians, reduceMotion, stop]);

  const pause = () => {
    stop();
    setPlaying(false);
    setPartial(0);
  };
  const play = () => {
    if (shown >= total) setShown(0);
    setPlaying(true);
  };
  const replay = () => {
    stop();
    setPartial(0);
    setShown(0);
    setPlaying(true);
  };
  const step = (delta: number) => {
    pause();
    setShown((s) => Math.min(total, Math.max(0, s + delta)));
  };

  const current = Math.min(shown + (playing ? 1 : 0), total);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="border-border bg-surface relative aspect-square w-full max-w-[320px] rounded-3xl border-2">
        <GridLines />
        <svg
          viewBox="0 0 1024 1024"
          className="absolute inset-0 size-full"
          role="img"
          aria-label={`Stroke order of ${hanzi}`}
        >
          <defs>
            {data.strokes.map((path, i) => (
              <clipPath id={`${clipBase}-${i}`} key={i}>
                <path d={path} transform={MMAH_TRANSFORM} />
              </clipPath>
            ))}
          </defs>
          <g transform={MMAH_TRANSFORM}>
            {data.strokes.map((path, i) => (
              <path
                key={`o-${i}`}
                d={path}
                fill="var(--surface-muted)"
                stroke="var(--border)"
                strokeWidth={6}
              />
            ))}
            {data.strokes.map((path, i) =>
              i < shown ? (
                <path
                  key={`s-${i}`}
                  d={path}
                  fill={i === shown - 1 && !playing ? "var(--primary)" : "var(--foreground)"}
                />
              ) : null,
            )}
          </g>
          {playing && shown < total ? (
            <g clipPath={`url(#${clipBase}-${shown})`}>
              <path
                d={medianPath(data.medians[shown]!)}
                transform={MMAH_TRANSFORM}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={150}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - partial}
              />
            </g>
          ) : null}
        </svg>
      </div>

      <p className="text-muted-foreground text-sm font-bold" aria-live="polite">
        {shown === 0 && !playing
          ? `${total} strokes — press play or next`
          : `Stroke ${current} of ${total}`}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Previous stroke"
          onClick={() => step(-1)}
          disabled={shown === 0 && !playing}
        >
          <ChevronLeft />
        </Button>
        {playing ? (
          <Button onClick={pause} aria-label="Pause animation">
            <Pause aria-hidden /> Pause
          </Button>
        ) : (
          <Button onClick={play} aria-label="Play animation">
            <Play aria-hidden /> Play
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          aria-label="Next stroke"
          onClick={() => step(1)}
          disabled={shown >= total}
        >
          <ChevronRight />
        </Button>
        <Button variant="secondary" size="icon" aria-label="Replay from the start" onClick={replay}>
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}

/** 米字格 practice grid drawn behind characters. */
export function GridLines() {
  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden
    >
      <g stroke="var(--border)" strokeWidth={0.6} strokeDasharray="2 2" fill="none">
        <line x1="50" y1="2" x2="50" y2="98" />
        <line x1="2" y1="50" x2="98" y2="50" />
        <line x1="4" y1="4" x2="96" y2="96" />
        <line x1="96" y1="4" x2="4" y2="96" />
      </g>
    </svg>
  );
}
