"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, RotateCcw, PenTool } from "lucide-react";

export default function PracticeHubPage() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 py-12">

            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-center mb-10"
            >
                <h1 className="text-4xl font-black text-primary tracking-tight mb-2">
                    Ready to Practice?
                </h1>
                <p className="text-muted-foreground">
                    Choose a mode to start writing characters.
                </p >
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">

                {/* Card 1: Lesson */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                >
                    <Card className="h-full flex flex-col border-border bg-surface hover:border-primary transition-colors cursor-pointer">
                        <CardHeader>
                            <BookOpen className="w-8 h-8 text-primary mb-2" />
                            <CardTitle className="text-foreground">Start a Lesson</CardTitle>
                            <CardDescription className="text-muted-foreground">Learn new characters step by step.</CardDescription>
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
                    <Card className="h-full flex flex-col border-border bg-surface hover:border-primary transition-colors cursor-pointer">
                        <CardHeader>
                            <RotateCcw className="w-8 h-8 text-primary mb-2" />
                            <CardTitle className="text-foreground">Review Characters</CardTitle>
                            <CardDescription className="text-muted-foreground">Practice words you have learned before.</CardDescription>
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
                    <Card className="h-full flex flex-col border-border bg-surface hover:border-primary transition-colors cursor-pointer">
                        <CardHeader>
                            <PenTool className="w-8 h-8 text-primary mb-2" />
                            <CardTitle className="text-foreground">Free Practice</CardTitle>
                            <CardDescription className="text-muted-foreground">Write any character you want freely.</CardDescription>
                        </CardHeader>
                        <CardContent className="mt-auto pt-4">
                            <Button asChild variant="ghost" className="w-full hover:bg-surface-muted">
                                <Link href="/practice/character">Start Drawing</Link>
                            </Button>
                        </CardContent>
                    </Card>
                </motion.div>

            </div>
        </div>
    );
}