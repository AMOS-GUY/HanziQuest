/** Browser-side calls to the learning API. */

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = (await response.json().catch(() => null)) as
    (T & { error?: undefined }) | { error: { code: string; message: string } } | null;
  if (!response.ok || !json || ("error" in json && json.error)) {
    const err =
      json && "error" in json && json.error
        ? json.error
        : { code: "network", message: "Request failed" };
    throw new ApiRequestError(response.status, err.code, err.message);
  }
  return json as T;
}

export interface AttemptResponse {
  attemptId: string;
  duplicate: boolean;
  result: string;
  score: number | null;
  mode: string;
  evaluation: unknown;
}

export const learningApi = {
  startSession: (lessonId: string) => post<{ sessionId: string }>("/api/sessions", { lessonId }),
  completeSession: (sessionId: string) =>
    post<{ completed: boolean; lessonId: string; nextLessonId: string | null }>(
      `/api/sessions/${sessionId}/complete`,
    ),
  submitAttempt: (payload: Record<string, unknown>) =>
    post<AttemptResponse>("/api/attempts", payload),
};

/** Retries transient failures (network / 5xx / 429) with backoff; client errors are not retried. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retriable =
        !(error instanceof ApiRequestError) ||
        error.status >= 500 ||
        error.status === 429 ||
        error.status === 0;
      if (!retriable) throw error;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastError;
}
