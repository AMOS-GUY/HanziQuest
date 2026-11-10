"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setCurriculumStatusAction } from "@/features/administration/actions";

type Status = "PUBLISHED" | "DRAFT" | "ARCHIVED";

const LABEL: Record<Status, string> = {
  PUBLISHED: "Published",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
};

/**
 * Releases or withdraws a whole curriculum. Learners only see lessons of a published
 * curriculum; withdrawing it hides them everywhere (links, downloads, reviews) but keeps history.
 */
export function CurriculumStatus({
  curriculumId,
  status,
  canPublish,
}: {
  curriculumId: string;
  status: Status;
  canPublish: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const change = (next: Status, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      setError(undefined);
      const result = await setCurriculumStatusAction({ curriculumId, status: next });
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={status === "PUBLISHED" ? "default" : "muted"}>{LABEL[status]}</Badge>
      {canPublish ? (
        <>
          {status !== "PUBLISHED" ? (
            <Button size="sm" disabled={pending} onClick={() => change("PUBLISHED")}>
              {pending ? "Saving…" : "Publish curriculum"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                change(
                  "DRAFT",
                  "Unpublish this curriculum? Learners lose access to all of its lessons until it is published again. Their history is kept.",
                )
              }
            >
              Unpublish
            </Button>
          )}
          {status !== "ARCHIVED" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                change(
                  "ARCHIVED",
                  "Archive this curriculum? Learners lose access to all of its lessons. Their history is kept.",
                )
              }
            >
              Archive
            </Button>
          ) : null}
        </>
      ) : null}
      {error ? (
        <span role="alert" className="text-danger text-xs font-semibold">
          {error}
        </span>
      ) : null}
    </div>
  );
}
