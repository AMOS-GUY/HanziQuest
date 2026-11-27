/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef } from "react";
import HanziWriter from "hanzi-writer";
import { usePracticeStore } from "@/stores/usePracticeStore";

export function HanziCanvas({
    character,
    mode = "animate",
    onComplete
}: {
    character: string;
    mode?: "animate" | "quiz";
    onComplete?: () => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const incrementScore = usePracticeStore((state) => state.incrementScore);

    useEffect(() => {
        if (!containerRef.current) return;

        while (containerRef.current.firstChild) {
            containerRef.current.removeChild(containerRef.current.firstChild);
        }

        const charDataLoader = async (char: string, onComplete: (data: any) => void) => {
            try {
                // 1. Check native browser LocalStorage first
                const cachedStr = localStorage.getItem(`char-${char}`);
                if (cachedStr) {
                    onComplete(JSON.parse(cachedStr));
                    return;
                }

                // 2. Load from your local src/data folder
                let data;
                if (char === "你") {
                    data = (await import("@/data/你.json")).default;
                } else if (char === "好") {
                    data = (await import("@/data/好.json")).default;
                } else {
                    const res = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${char}.json`);
                    data = await res.json();
                }

                // 3. Save to LocalStorage
                localStorage.setItem(`char-${char}`, JSON.stringify(data));
                onComplete(data);
            } catch (err) {
                console.error("Error loading char data:", err);
            }
        };

        const writer = HanziWriter.create(containerRef.current, character, {
            width: 200,
            height: 200,
            padding: 5,
            showOutline: true,
            strokeAnimationSpeed: 1,
            delayBetweenStrokes: 200,
            strokeColor: "#087f70",
            radicalColor: "#55cdb5",
            charDataLoader: charDataLoader as any,
        });

        if (mode === "quiz") {
            writer.quiz({
                onComplete: (summary: any) => {
                    if (summary.totalMistakes === 0) {
                        incrementScore();
                        if (onComplete) onComplete();
                    } else {
                        setTimeout(() => {
                            if (containerRef.current) {
                                while (containerRef.current.firstChild) {
                                    containerRef.current.removeChild(containerRef.current.firstChild);
                                }
                                const newWriter = HanziWriter.create(containerRef.current, character, {
                                    width: 200, height: 200, padding: 5, showOutline: true,
                                    strokeColor: "#087f70", radicalColor: "#55cdb5",
                                    charDataLoader: charDataLoader as any
                                });
                                newWriter.quiz();
                            }
                        }, 1000);
                    }
                }
            });
        } else {
            writer.animateCharacter();
        }

    }, [character, mode, incrementScore, onComplete]);

    return (
        <div className="flex flex-col items-center justify-center p-4 bg-surface rounded-xl shadow-sm border border-border">
            <div ref={containerRef} className="w-[200px] h-[200px]" />
            <p className="mt-4 text-sm text-muted-foreground">
                {mode === "quiz" ? "Draw the character" : "Watch the stroke order"}
            </p >
        </div>
    );
}