/** Shared type definitions across the application. */

export interface TranslationRecord {
  id: number;
  original: string;
  translated: string;
  direction: string;
  timestamp: number;
}

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface HotkeyEntry {
  action: string;
  shortcut: string;
}

export interface ServiceProfile {
  name: string;
  baseUrl: string;
  model: string;
}

export interface TmEntry {
  id: number;
  source: string;
  target: string;
  source_lang: string;
  target_lang: string;
  created_at: number;
  hit_count: number;
}

export interface TmStats {
  total_entries: number;
  total_hits: number;
}
