"use client";

import { useRef, useState, useTransition } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HandwritingCanvas } from "@/components/handwriting/handwriting-canvas";
import type { InkStroke } from "@/features/handwriting/types";
import {
  recordHandwritingSampleAction,
  type RecordSampleResult,
} from "@/features/handwriting/lab-actions";
import { CATEGORY_LABEL, SAMPLE_CATEGORIES } from "@/features/handwriting/validation";
import { cn } from "@/lib/utilities/cn";

const select =
  "border-border bg-surface focus-visible:border-primary h-11 w-full rounded-xl border-2 px-3 focus-visible:outline-none";

/** Records labelled samples for the validation study. */
export function SampleRecorder({ characters }: { characters: string[] }) {
  const [participant, setParticipant] = useState("");
  const [hanzi, setHanzi] = useState(characters[0] ?? "");
  const [category, setCategory] = useState<(typeof SAMPLE_CATEGORIES)[number]>("CORRECT");
  const [written, setWritten] = useState("");
  const [device, setDevice] = useState("finger");
  const [style, setStyle] = useState("");
  const [consent, setConsent] = useState(false);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [result, setResult] = useState<RecordSampleResult>();
  const [pending, start] = useTransition();
  const [canvasKey, setCanvasKey] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const record = () =>
    start(async () => {
      const r = await recordHandwritingSampleAction({
        participantCode: participant,
        hanzi,
        category,
        writtenHanzi: category === "WRONG_CHARACTER" ? written : null,
        style: style || null,
        inputDevice: device,
        canvasSizePx: Math.round(box.current?.getBoundingClientRect().width ?? 0) || undefined,
        strokes,
        consentConfirmed: consent,
      });
      setResult(r);
      if (r.ok) {
        setStrokes([]);
        setCanvasKey((k) => k + 1);
      }
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lab-participant">Participant code</Label>
          <Input
            id="lab-participant"
            value={participant}
            onChange={(e) => setParticipant(e.target.value)}
            placeholder="P07"
            aria-describedby="lab-participant-help"
          />
          <p id="lab-participant-help" className="text-muted-foreground text-xs">
            Never a name or email.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lab-char">Character asked for</Label>
          <select
            id="lab-char"
            className={cn(select, "hanzi")}
            lang="zh"
            value={hanzi}
            onChange={(e) => setHanzi(e.target.value)}
          >
            {characters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lab-category">What the participant writes</Label>
          <select
            id="lab-category"
            className={select}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {SAMPLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        {category === "WRONG_CHARACTER" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lab-written">Character actually written</Label>
            <Input
              id="lab-written"
              lang="zh"
              className="hanzi"
              value={written}
              onChange={(e) => setWritten(e.target.value)}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lab-device">Input</Label>
          <select
            id="lab-device"
            className={select}
            value={device}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="finger">Finger</option>
            <option value="stylus">Stylus</option>
            <option value="mouse">Mouse</option>
            <option value="trackpad">Trackpad</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lab-style">Style note (optional)</Label>
          <Input
            id="lab-style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="fast, small, left-handed…"
          />
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          The participant agreed to their handwriting being stored for testing, as described in the
          collection procedure.
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-center text-sm font-bold">
          Ask for{" "}
          <span lang="zh" className="hanzi text-2xl">
            {hanzi}
          </span>{" "}
          · {CATEGORY_LABEL[category].toLowerCase()}
        </p>
        <div ref={box}>
          <HandwritingCanvas
            key={canvasKey}
            strokes={strokes}
            onChange={setStrokes}
            label="Sample writing area"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!strokes.length}
            onClick={() => setStrokes((s) => s.slice(0, -1))}
          >
            <Undo2 aria-hidden /> Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!strokes.length}
            onClick={() => {
              setStrokes([]);
              setCanvasKey((k) => k + 1);
            }}
          >
            <Eraser aria-hidden /> Clear
          </Button>
          <Button size="sm" disabled={!strokes.length || pending} onClick={record}>
            {pending ? "Saving…" : "Record"}
          </Button>
        </div>
        {result ? (
          <div
            role={result.ok ? "status" : "alert"}
            className="bg-surface-muted rounded-xl p-3 text-sm"
          >
            <p className={cn("font-bold", !result.ok && "text-danger")}>{result.message}</p>
            {result.ok ? (
              <>
                <p className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="muted">{result.band}</Badge>
                  <Badge
                    variant={result.accepted === (category === "CORRECT") ? "default" : "danger"}
                  >
                    {result.accepted ? "accepted" : "rejected"}
                    {result.accepted === (category === "CORRECT")
                      ? " (as expected)"
                      : " (unexpected)"}
                  </Badge>
                  {category !== "CORRECT" ? (
                    <Badge variant={result.detected ? "default" : "warning"}>
                      error {result.detected ? "named" : "not named"}
                    </Badge>
                  ) : null}
                </p>
                {result.feedback?.length ? (
                  <ul className="text-muted-foreground mt-1 list-disc pl-5">
                    {result.feedback.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
