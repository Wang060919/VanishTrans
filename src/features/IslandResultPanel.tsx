import { useEffect, useRef, useState } from "react";
import type { TranslationResult } from "../lib/translationResult";
import { errorMessage } from "../lib/errors";
import { writeClipboardSafe } from "../services/tauriBridge";
import QuickTranslationView from "./QuickTranslationView";

interface Props {
  result: TranslationResult;
  onExpand: () => void;
  onClose: () => void;
  preview?: boolean;
}

/** Presents a committed snapshot; the originating session still owns translation. */
export default function IslandResultPanel({ result, onExpand, onClose, preview = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    setCopied(false);
    setCopyError("");
    return () => {
      generation.current = currentGeneration + 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [result]);
  const copy = async () => {
    const request = generation.current;
    try {
      if (!preview) await writeClipboardSafe({ text: result.text });
      if (request !== generation.current) return;
      setCopied(true);
      setCopyError("");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      if (request === generation.current) setCopyError(errorMessage(error) || "复制失败，请重试");
    }
  };
  return (
    <>
      <QuickTranslationView embedded directionLabel={result.direction === "en2zh" ? "英语 → 简体中文" : "简体中文 → 英语"} source={result.source} output={result.text} loading={false}
        copied={copied} onCopy={() => void copy()} onExpand={onExpand}
        onClose={onClose} onRetry={() => {}} />
      {copyError && <p className="translation-island__copy-error" role="alert">{copyError}</p>}
    </>
  );
}
