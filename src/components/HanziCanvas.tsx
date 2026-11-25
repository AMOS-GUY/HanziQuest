 "use client";
import { usePracticeStore } from "@/stores/usePracticeStore";
import { useEffect, useRef } from "react";
import HanziWriter from "hanzi-writer";
import { writer } from "node:repl";

export function HanziCanvas({ character, mode = "animate", onComplete }: { character: string; mode?: "animate" | "quiz"; onComplete?: () => void }) {
    {
        const containerRef = useRef<HTMLDivElement>(null);
        const incrementScore = usePracticeStore((state) => state.incrementScore);

        useEffect(() => {
            if (!containerRef.current) return;

            // Clear previous canvas
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

            // Handle Animate vs Quiz mode
            if (mode === "quiz") {
                writer.quiz({
                    onComplete: (summary) => {
                        console.log("Quiz complete! Mistakes:", summary.totalMistakes);
                        if (summary.totalMistakes === 0) {
                            incrementScore();
                            if (onComplete) {
                                onComplete();
                            }
                        } else {
                            console.log("Too many mistakes. Resetting...");
                            setTimeout(() => {
                                // Clear the canvas and restart the quiz
                                if (containerRef.current) {
                                    while (containerRef.current.firstChild) {
                                        containerRef.current.removeChild(containerRef.current.firstChild);
                                    }
                                    const newWriter = HanziWriter.create(containerRef.current, character, {
                                        width: 200, height: 200, padding: 5, showOutline: true,
                                        strokeColor: "#087f70", radicalColor: "#55cdb5",
                                        charDataLoader: (char, onComplete) => {
                                            fetch(`/${char}.json`).then(r => r.json()).then(d => onComplete(d));
                                        }
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
                </p>
            </div>
        );
    }
}