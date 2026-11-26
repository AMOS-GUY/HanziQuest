"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, RotateCcw, PenTool } from "lucide-react";

export default function PracticeHubPage() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 text-center"
      >
        <h1 className="text-primary mb-2 text-4xl font-black tracking-tight">Ready to Practice?</h1>
        <p className="text-muted-foreground">Choose a mode to start writing characters.</p>
      </motion.div>

      <div className="grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-3">
        {/* Card 1: Lesson */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="border-border bg-surface hover:border-primary flex h-full cursor-pointer flex-col transition-colors">
            <CardHeader>
              <BookOpen className="text-primary mb-2 h-8 w-8" />
              <CardTitle className="text-foreground">Start a Lesson</CardTitle>
              <CardDescription className="text-muted-foreground">
                Learn new characters step by step.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-4">
              <Button asChild className="w-full">
                <Link href="/practice/lesson/1">Start Lesson</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Card 2: Review */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card className="border-border bg-surface hover:border-primary flex h-full cursor-pointer flex-col transition-colors">
            <CardHeader>
              <RotateCcw className="text-primary mb-2 h-8 w-8" />
              <CardTitle className="text-foreground">Review Characters</CardTitle>
              <CardDescription className="text-muted-foreground">
                Practice words you have learned before.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-4">
              <Button asChild variant="secondary" className="w-full">
                <Link href="/practice/review">Start Review</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Card 3: Free Practice */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Card className="border-border bg-surface hover:border-primary flex h-full cursor-pointer flex-col transition-colors">
            <CardHeader>
              <PenTool className="text-primary mb-2 h-8 w-8" />
              <CardTitle className="text-foreground">Free Practice</CardTitle>
              <CardDescription className="text-muted-foreground">
                Write any character you want freely.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-4">
              <Button asChild variant="ghost" className="hover:bg-surface-muted w-full">
                <Link href="/practice/character">Start Drawing</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
