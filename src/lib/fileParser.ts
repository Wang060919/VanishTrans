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
  const sections = normalized.split(/\n\n+/).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0].trim(), 10);
    if (isNaN(index)) continue;

    const timecode = lines[1].trim();
    const text = lines.slice(2).join("\n").trim();

    if (timecode.includes("-->") && text) {
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
    value.forEach((item, i) => collectStrings(item, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      collectStrings(val, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * Apply translated segments back into the original JSON structure.
 * Takes the original JSON string and a map of path → translated text.
 */
export function rebuildJson(original: string, translations: Map<string, string>): string {
  const obj = JSON.parse(original);
  applyTranslations(obj, "", translations);
  return JSON.stringify(obj, null, 2);
}

function applyTranslations(value: unknown, path: string, translations: Map<string, string>): void {
  if (typeof value === "string") {
    const translated = translations.get(path);
    if (translated !== undefined) {
      (value as any) = translated; // JSON parse returns mutable objects
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => applyTranslations(item, `${path}[${i}]`, translations));
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      applyTranslations(val, path ? `${path}.${key}` : key, translations);
    }
  }
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

/** Max file size in bytes before warning. */
export const MAX_FILE_SIZE = 50 * 1024;
