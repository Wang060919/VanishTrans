/** Shared type definitions across the application. */

export interface TranslationRecord {
  id: number;
  original: string;
  translated: string;
  direction: string;
  timestamp: number;
}
