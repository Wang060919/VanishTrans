/**
 * File parsing utilities for drag-and-drop translation.
 * Supports .txt, .srt (subtitle), and .json file formats.
 */

// ── SRT Parser ──────────────────────────────────────────────

export interface SrtBlock {
  index: number;
  timecode: string;
  text: string;
}

/** Parse an SRT subtitle file into structured blocks. */
export function parseSrt(content: string): SrtBlock[] {
  const blocks: SrtBlock[] = [];
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Split on blank lines — each section is one subtitle block
  const sections = normalized.split(/\n\n+/).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    if (lines.length < 2) continue;

    const index = parseInt(lines[0].trim(), 10);
    if (isNaN(index)) continue;

    const timecode = lines[1].trim();
    if (!timecode.includes("-->")) continue;

    // Text is everything after the timecode line (supports multi-line subtitles)
    const text = lines.slice(2).join("\n").trim();
    if (text) {
      blocks.push({ index, timecode, text });
    }
  }
  return blocks;
}

/** Reassemble SRT blocks back into a string. */
export function rebuildSrt(blocks: SrtBlock[]): string {
  return blocks
    .map((b) => `${b.index}\n${b.timecode}\n${b.text}`)
    .join("\n\n");
}

// ── JSON Parser ─────────────────────────────────────────────

export interface JsonSegment {
  /** RFC 6901 JSON Pointer, with "" representing the root value. */
  path: string;
  text: string;
}

/**
 * Parse a JSON value into translatable segments.
 * Each segment has a dot-separated path and the string value.
 */
export function parseJson(content: string): JsonSegment[] {
  const obj = JSON.parse(content);
  const segments: JsonSegment[] = [];
  collectStrings(obj, "", segments);
  return segments;
}

function collectStrings(value: unknown, path: string, out: JsonSegment[]): void {
  if (typeof value === "string" && value.trim()) {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => collectStrings(item, appendJsonPointer(path, i), out));
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      collectStrings(val, appendJsonPointer(path, key), out);
    }
  }
}

function appendJsonPointer(path: string, segment: string | number): string {
  const escaped = String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${path}/${escaped}`;
}

/**
 * Apply translated segments back into the original JSON structure.
 * Takes the original JSON string and a map of path → translated text.
 */
export function rebuildJson(original: string, translations: Map<string, string>): string {
  const obj = JSON.parse(original);
  return JSON.stringify(applyTranslations(obj, "", translations), null, 2);
}

/**
 * Recursively rebuild the JSON value with mapped strings replaced.
 * Returning the updated value also supports a root-level JSON string.
 */
function applyTranslations(
  value: unknown,
  path: string,
  translations: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    return translations.get(path) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => applyTranslations(item, appendJsonPointer(path, index), translations));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        applyTranslations(item, appendJsonPointer(path, key), translations),
      ]),
    );
  }
  return value;
}

// ── File Type Detection ─────────────────────────────────────

export type FileType = "txt" | "srt" | "json" | "unknown";

export function detectFileType(filename: string): FileType {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "txt") return "txt";
  if (ext === "srt") return "srt";
  if (ext === "json") return "json";
  return "unknown";
}

/** Maximum source characters accepted by the translation backend. */
export const MAX_TRANSLATION_CHARS = 10_000;
