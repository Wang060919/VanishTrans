import type { LangDirection } from "../hooks/useTranslationSession";

/** Completed text, shared only after its request has committed. */
export interface TranslationResult {
  source: string;
  text: string;
  direction: LangDirection;
}
export interface IslandResult extends TranslationResult {
  sourceId: string;
  requestId: number;
  revision: number;
}

export function readTranslationResult(value: unknown): TranslationResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<TranslationResult>;
  const directions: unknown[] = ["auto", "auto2zh", "auto2en", "zh2en", "en2zh"];
  if (typeof result.source !== "string" || !result.source.trim() ||
      typeof result.text !== "string" || !result.text.trim() ||
      !directions.includes(result.direction)) return null;
  return { source: result.source, text: result.text, direction: result.direction! };
}
