"use client";

import Link from "next/link";
import { MotionConfig, motion } from "framer-motion";
import { ArrowLeft, BookOpen, PenTool, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Practice hub: the three ways to practise, with real destinations. Design by Anesu (PR #35);
 * data and links wired to the learner's actual next lesson and reviews.
 */
export function PracticeHub({
  nextLesson,
  dueNow,
}: {
  nextLesson: { id: string; title: string } | null;
  dueNow: number;
}) {
  const appear = (delay: number) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay },
  });

  return (
    // "user": framer-motion drops the movement when the system asks for reduced motion.
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
        <div className="mb-6 w-full max-w-4xl">
          <Button asChild variant="ghost" size="sm">
            <Link href="/home">
              <ArrowLeft aria-hidden /> Home
            </Link>
          </Button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center"
        >
          <h1 className="text-primary mb-2 text-4xl font-black tracking-tight">
            Ready to Practice?
          </h1>
          <p className="text-muted-foreground">Choose a mode to start writing characters.</p>
        </motion.div>

        <div className="grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-3">
          <motion.div {...appear(0.1)}>
            <Card className="border-border bg-surface hover:border-primary flex h-full flex-col transition-colors">
              <CardHeader>
                <BookOpen className="text-primary mb-2 h-8 w-8" aria-hidden />
                <CardTitle className="text-foreground">
                  {nextLesson ? "Continue the trail" : "Your lessons"}
                </CardTitle>
                <CardDescription>
                  {nextLesson
                    ? `Next up: “${nextLesson.title}”.`
                    : "See every lesson on your learning path."}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild className="w-full">
                  <Link href={nextLesson ? `/learn/${nextLesson.id}` : "/learn"}>
                    {nextLesson ? "Start lesson" : "View lessons"}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...appear(0.2)}>
            <Card className="border-border bg-surface hover:border-primary flex h-full flex-col transition-colors">
              <CardHeader>
                <RotateCcw className="text-primary mb-2 h-8 w-8" aria-hidden />
                <CardTitle className="text-foreground">Review characters</CardTitle>
                <CardDescription>
                  {dueNow > 0
                    ? `${dueNow} character${dueNow === 1 ? "" : "s"} ready to review.`
                    : "Nothing is due right now. Characters you write come back here."}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/review">{dueNow > 0 ? "Start review" : "Open reviews"}</Link>
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...appear(0.3)}>
            <Card className="border-border bg-surface hover:border-primary flex h-full flex-col transition-colors">
              <CardHeader>
                <PenTool className="text-primary mb-2 h-8 w-8" aria-hidden />
                <CardTitle className="text-foreground">Practise a character</CardTitle>
                <CardDescription>
                  Pick any character you&apos;ve met and write it again.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild variant="ghost" className="hover:bg-surface-muted w-full">
                  <Link href="/progress#characters">Choose a character</Link>
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </MotionConfig>
  );
}
