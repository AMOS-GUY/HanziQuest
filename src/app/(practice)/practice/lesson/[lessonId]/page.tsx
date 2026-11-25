"use client"
import { useState } from "react";
import { motion } from "framer-motion";
import { usePracticeStore } from "@/stores/usePracticeStore";
import { HanziCanvas } from "@/components/HanziCanvas";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getLessonPractice } from "@/features/learning/lesson-data";
import { getLessonState } from "@/features/progression/lesson-states";
import { PracticeRunner } from "@/components/lessons/practice-runner";



export default function LessonPracticePage() {
 
    const [mode, setMode] = useState<"animate" | "quiz">("animate"); 
    const { score, characters, currentIndex, nextCharacter } = usePracticeStore();
    const currentCharacter = characters[currentIndex] || { hanzi: "你", meaning: "You" }; // Default character if out of bounds}
        console.log("Current score from store:", score);
    // const user = await requireUser();
    // const user = await requireUser();
    const user = { id: "test-user" }; // Fake user

    // We need to extract the lessonId from the URL params
    const lessonId = 1; // Hardcoded for testing, replace with actual logic to get lessonId from URL

    // Fake data so the UI loads without a database
  
        const payload = {
            title: "Test Lesson",
            characters: ["你", "好"],
            exercises: [],
            strokeData: {},
            candidates: []
        };
  
   
    return (
        <div className="flex flex-col items-center pt-12 min-h-[80vh] gap-6 px-4 w-full">

            {/* Score Display */}
            <div className="text-2xl font-bold text-primary">
                Score: {score}
            </div>

            {/* Watch/Practice Toggle */}
            <div className="flex flex-row items-center justify-center gap-4">
                <button
                    onClick={() => setMode("animate")}
                    className={`px-6 py-2 rounded-md font-medium transition-colors ${mode === "animate" ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-foreground hover:bg-surface-muted"}`}
                >
                    Watch
                </button>
                <button
                    onClick={() => setMode("quiz")}
                    className={`px-6 py-2 rounded-md font-medium transition-colors ${mode === "quiz" ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-foreground hover:bg-surface-muted"}`}
                >
                    Practice
                </button>
            </div>

            {/* English Meaning Prompt */}
            <motion.div
                key={currentCharacter.hanzi}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="text-center"
            >
                <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">Draw this meaning:</p >
                <h2 className="text-3xl font-bold text-primary">{currentCharacter.meaning}</h2>
            </motion.div>

            {/* The Canvas */}
            <HanziCanvas character={currentCharacter.hanzi} mode={mode} onComplete={nextCharacter} />

        </div>
    );
}