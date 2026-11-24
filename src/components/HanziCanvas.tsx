"use client";

import { useEffect, useRef } from "react";
import HanziWriter from "hanzi-writer";

export function HanziCanvas({ character, mode = "animate" }: { character: string, mode?: "animate" | "quiz" }) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Clear previous canvas to prevent double rendering in Strict Mode
        while (containerRef.current.firstChild) {
            containerRef.current.removeChild(containerRef.current.firstChild);
        }

        // Initialize Hanzi Writer
        const writer = HanziWriter.create(containerRef.current, character, {
            width: 200,
            height: 200,
            padding: 5,
            showOutline: true,
            strokeAnimationSpeed: 1,
            delayBetweenStrokes: 200,
            strokeColor: "#087f70", // Brand emerald
            radicalColor: "#55cdb5", // Brand mint
            charDataLoader: (char, onComplete) => {
                fetch(`/${char}.json`)
                    .then((res) => res.json())
                    .then((data) => onComplete(data))
                    .catch((err) => console.error("Error loading char data:", err));
            },
        });

        // NEW: Handle Animate vs Quiz mode
        if (mode === "quiz") {
            writer.quiz({
                onComplete: (summary) => {
                    console.log("Quiz complete! Mistakes:", summary.totalMistakes);
                }
            });
        } else {
            writer.animateCharacter();
        }

    }, [character, mode]); // Add 'mode' here so it re-runs when the mode changes 
    return (
        <div className="flex flex-col items-center justify-center p-4 bg-surface rounded-xl shadow-sm border border-border">
            <div ref={containerRef} className="w-[200px] h-[200px]"  />
            <p className="mt-4 text-sm text-muted-foreground">Watch the stroke order</p >
        </div>
    );
}