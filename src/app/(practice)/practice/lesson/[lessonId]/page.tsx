import { useState } from "react";
import { HanziCanvas } from "@/components/HanziCanvas";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getLessonPractice } from "@/features/learning/lesson-data";
import { getLessonState } from "@/features/progression/lesson-states";
import { PracticeRunner } from "@/components/lessons/practice-runner";

export const metadata: Metadata = { title: "Practice" };

export default function LessonPracticePage() {
 
    const [mode, setMode] = useState<"animate" | "quiz">("animate"); 
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
        <div className="flex flex-col items-center justify-center min-h-[80vh]">
            <HanziCanvas character="你" />
        </div>
    );
}
