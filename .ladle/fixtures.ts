import type { IslandResult } from "../src/lib/translationResult";
import type { TmEntry, TranslationRecord } from "../src/types";

export const SAMPLE_SOURCE = "Good tools disappear into the work.\nThey help you stay focused on what matters.";
export const SAMPLE_TEXT = "好的工具会融入工作，\n让你专注于真正重要的事。";
export const SAMPLE_RESULT: IslandResult = {
  source: SAMPLE_SOURCE, text: SAMPLE_TEXT, direction: "en2zh",
  sourceId: "ladle", requestId: 1, revision: 1,
};
const timestamp = Math.floor(Date.now() / 1000);
export const HISTORY_RECORDS: TranslationRecord[] = [
  { id: 1, original: SAMPLE_SOURCE, translated: SAMPLE_TEXT, direction: "英语 → 中文", timestamp },
  { id: 2, original: "Make room for what matters.", translated: "为重要的事留出空间。", direction: "英语 → 中文", timestamp: timestamp - 3600 },
  { id: 3, original: "简单、长期可维护。", translated: "Simple and maintainable over time.", direction: "中文 → 英语", timestamp: timestamp - 86400 },
];
export const TM_ENTRIES: TmEntry[] = HISTORY_RECORDS.map((record) => ({
  id: record.id, source: record.original, target: record.translated,
  source_lang: record.id === 3 ? "Chinese" : "English",
  target_lang: record.id === 3 ? "English" : "Chinese",
  created_at: record.timestamp, hit_count: record.id * 3,
}));
