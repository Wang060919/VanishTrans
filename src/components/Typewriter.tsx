import { useEffect, useRef, useState } from "react";

/** Texts longer than this skip the typewriter effect and render immediately. */
const LONG_TEXT_THRESHOLD = 200;

interface TypewriterProps {
  text: string;
  speed?: number;
  className?: string;
}

/**
 * Typewriter — reveals characters using chained setTimeout for reliable fake-timer testing.
 * Batches characters in groups for long texts to avoid per-character re-renders.
 * Skips the effect entirely for texts over {@link LONG_TEXT_THRESHOLD} chars.
 */
export default function Typewriter({ text, speed = 30, className }: TypewriterProps) {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // Skip typewriter for long texts — render immediately
    if (text.length > LONG_TEXT_THRESHOLD) {
      setCount(text.length);
      return;
    }

    setCount(0);
    if (text.length === 0) return;

    // For very fast speeds or long texts, batch characters
    const batchSize = speed < 10 ? Math.max(1, Math.floor(10 / speed)) : 1;
    let current = 0;

    const tick = () => {
      current = Math.min(current + batchSize, text.length);
      setCount(current);
      if (current < text.length) {
        timerRef.current = setTimeout(tick, Math.max(speed, 1));
      }
    };

    timerRef.current = setTimeout(tick, Math.max(speed, 1));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, speed]);

  return <span className={className}>{text.slice(0, count)}</span>;
}
