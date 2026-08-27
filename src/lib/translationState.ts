/**
 * Translation state management utilities.
 * Handles request ID generation and validation.
 */

/**
 * Monotonically increasing translation ID counter for forcing Typewriter re-mount.
 */
let translationIdCounter = 0;

/**
 * Generate next translation key for component re-mounting.
 */
export function generateTranslationKey(): number {
  return ++translationIdCounter;
}

/**
 * Create a new request ID for tracking async operations.
 */
export function createRequestId(currentRef: { current: number }): number {
  return ++currentRef.current;
}

/**
 * Check if a request is still current (not superseded by newer request).
 */
export function isCurrentRequest(
  requestId: number,
  currentRef: { current: number }
): boolean {
  return requestId === currentRef.current;
}

/**
 * Check if a request has already been marked complete.
 */
export function isCompletedRequest(
  requestId: number,
  completedRef: { current: number | null }
): boolean {
  return requestId === completedRef.current;
}

/**
 * Mark a request as completed.
 */
export function markRequestCompleted(
  requestId: number,
  completedRef: { current: number | null }
): void {
  completedRef.current = requestId;
}

/**
 * Invalidate current request (for cancellation).
 */
export function invalidateCurrentRequest(currentRef: { current: number }): void {
  ++currentRef.current;
}
