"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setLessonStatusAction } from "@/features/administration/actions";

export function LessonStatusToggle({ lessonId, status }: { lessonId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const published = status === "PUBLISHED";

  return (
    <div className="flex items-center gap-2">
      <Badge variant={published ? "default" : "muted"}>{published ? "Published" : "Draft"}</Badge>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await setLessonStatusAction({
              lessonId,
              status: published ? "DRAFT" : "PUBLISHED",
            });
            if (!result.ok) setError(result.message);
          })
        }
      >
        {pending ? "Saving…" : published ? "Unpublish" : "Publish"}
      </Button>
      {error ? (
        <span role="alert" className="text-danger text-xs font-semibold">
          {error}
        </span>
      ) : null}
    </div>
  );
}
