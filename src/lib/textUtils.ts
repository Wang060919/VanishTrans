/**
 * Text processing utilities - pure functions only.
 * No side effects, no DOM access, no API calls.
 */

/**
 * Count Unicode-aware character length.
 */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/**
 * Format number with locale-specific thousands separators.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Check if text starts with error marker.
 */
export function isErrorMessage(text: string): boolean {
  return text.startsWith("❌");
}

/**
 * Remove error marker prefix from text.
 */
export function stripErrorMarker(text: string): string {
  return text.replace(/^❌\s*/, "");
}

/**
 * Check if text is non-empty after trimming.
 */
export function hasContent(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Truncate text to maximum length, preserving full Unicode characters.
 */
export function truncateText(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return chars.slice(0, maxLength).join("");
}

/**
 * Calculate whether input is within character limit.
 */
export function isWithinLimit(text: string, limit: number): boolean {
  return countChars(text) <= limit;
}
