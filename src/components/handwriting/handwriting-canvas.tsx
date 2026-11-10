"use client";

import { useCallback, useEffect, useRef } from "react";
import type { InkPoint, InkStroke } from "@/features/handwriting/types";
import { GridLines } from "@/components/characters/stroke-order-player";
import { cn } from "@/lib/utilities/cn";

const MIN_POINT_DISTANCE = 0.003;

/**
 * Pointer-Events drawing surface for one character. Supports mouse, touch and stylus;
 * captures normalised points (0–1, y down) with timestamps; renders crisply on high-DPI screens;
 * prevents page scrolling while drawing.
 */
export function HandwritingCanvas({
  strokes,
  onChange,
  ghost,
  disabled,
  label,
  className,
}: {
  strokes: InkStroke[];
  onChange: (strokes: InkStroke[]) => void;
  /** Character shown faintly underneath as a hint. */
  ghost?: string | null;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ pointerId: number; points: InkPoint[] } | null>(null);
  const timeOrigin = useRef<number | null>(null);
  const strokesRef = useRef(strokes);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const color = getComputedStyle(canvas).getPropertyValue("--foreground").trim() || "#18332f";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width * 0.035;
    const all = [
      ...strokesRef.current,
      ...(active.current ? [{ points: active.current.points }] : []),
    ];
    for (const stroke of all) {
      const pts = stroke.points.map((p) => [p.x * width, p.y * height] as const);
      if (pts.length === 0) continue;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0]![0], pts[0]![1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length - 1; i += 1) {
        const midX = (pts[i]![0] + pts[i + 1]![0]) / 2;
        const midY = (pts[i]![1] + pts[i + 1]![1]) / 2;
        ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], midX, midY);
      }
      const last = pts[pts.length - 1]!;
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    if (strokes.length === 0) timeOrigin.current = null;
    redraw();
  }, [strokes, redraw]);

  // Keep the backing store matched to CSS size × devicePixelRatio.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [redraw]);

  const toPoint = (event: PointerEvent | React.PointerEvent, rect: DOMRect): InkPoint => {
    timeOrigin.current ??= event.timeStamp;
    return {
      x: Math.min(1.2, Math.max(-0.2, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1.2, Math.max(-0.2, (event.clientY - rect.top) / rect.height)),
      t: Math.max(0, Math.round(event.timeStamp - timeOrigin.current)),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || active.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    active.current = { pointerId: event.pointerId, points: [toPoint(event, rect)] };
    redraw();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const native = event.nativeEvent;
    const events =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
    for (const e of events.length > 0 ? events : [native]) {
      const point = toPoint(e, rect);
      const last = current.points[current.points.length - 1]!;
      if (Math.hypot(point.x - last.x, point.y - last.y) >= MIN_POINT_DISTANCE)
        current.points.push(point);
    }
    redraw();
  };

  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    active.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onChange([...strokesRef.current, { points: current.points }]);
  };

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "border-border bg-surface relative aspect-square w-full touch-none overflow-hidden rounded-3xl border-2 select-none",
        disabled && "opacity-70",
        className,
      )}
    >
      <GridLines />
      {ghost ? (
        <span
          lang="zh"
          aria-hidden
          className="hanzi text-foreground/15 pointer-events-none absolute inset-0 flex items-center justify-center text-[min(62vw,13rem)] leading-none"
        >
          {ghost}
        </span>
      ) : null}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 size-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
