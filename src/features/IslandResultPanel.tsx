import { useEffect, useRef, useState } from "react";
import type { TranslationResult } from "../lib/translationResult";
import type { LangDirection } from "../hooks/useTranslationSession";
import { errorMessage } from "../lib/errors";
import { writeClipboardSafe } from "../services/tauriBridge";
import QuickTranslationView from "./QuickTranslationView";

interface Props {
  result: TranslationResult;
  onExpand: () => void;
  onClose: () => void;
  preview?: boolean;
}

const EXPLICIT_DIRECTION_LABELS: Partial<Record<LangDirection, string>> = {
  en2zh: "英语 → 简体中文",
  zh2en: "简体中文 → 英语",
  auto2zh: "自动检测 → 简体中文",
  auto2en: "自动检测 → 英语",
};

// Same CJK ranges as translate::language::resolve_target_lang.
const CJK_PATTERN = /[㐀-䶿一-鿿豈-﫿︰-﹏𠀀-𪛟𪜀-𫜿𫝀-𫠿𫠠-𬺯]/u;

/** The stored direction is the *requested* one; resolve "auto" like the backend
 *  (CJK ratio > 0.3 → English target) so the card never mislabels the result. */
function directionLabelFor(direction: LangDirection, source: string): string {
  const explicit = EXPLICIT_DIRECTION_LABELS[direction];
  if (explicit) return explicit;
  const chars = [...source];
  const cjk = chars.filter((char) => CJK_PATTERN.test(char)).length;
  return chars.length > 0 && cjk / chars.length > 0.3
    ? "简体中文 → 英语"
    : "英语 → 简体中文";
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
      <QuickTranslationView embedded directionLabel={directionLabelFor(result.direction, result.source)} source={result.source} output={result.text} loading={false}
        copied={copied} onCopy={() => void copy()} onExpand={onExpand}
        onClose={onClose} onRetry={() => {}} />
      {copyError && <p className="translation-island__copy-error" role="alert">{copyError}</p>}
    </>
  );
}
