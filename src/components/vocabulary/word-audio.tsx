import { cn } from "@/lib/utilities/cn";

/**
 * Pronunciation playback for a word, provider-independent: it plays whatever `Vocabulary.audioUrl`
 * holds (a same-origin path today; the CSP allows `media-src 'self' blob:`). With no recording it
 * renders nothing: no fake button or placeholder sound. `preload="none"` keeps lists cheap.
 * See docs/m16/M16-audio-foundation.md.
 */
export function WordAudio({
  src,
  word,
  className,
}: {
  src: string | null | undefined;
  word: string;
  className?: string;
}) {
  if (!src) return null;
  return (
    <audio
      controls
      preload="none"
      src={src}
      aria-label={`Pronunciation of ${word}`}
      className={cn("h-9 max-w-full", className)}
    >
      Your browser can&apos;t play this recording.
    </audio>
  );
}
