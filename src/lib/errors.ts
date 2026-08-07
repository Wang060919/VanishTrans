/**
 * Unified command-error helpers.
 *
 * Tauri commands return `CommandError { code, message }`; the helpers below
 * also tolerate plain strings and `Error` instances so tests and legacy call
 * sites keep working.
 */

export interface CommandErrorLike {
  code?: unknown;
  message?: unknown;
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as CommandErrorLike).code;
  return typeof code === "string" ? code : undefined;
}

export function errorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.replace(/^Error:\s*/, "");
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const message = (error as CommandErrorLike).message;
    if (typeof message === "string" && message) return message;
    const code = errorCode(error);
    if (code) return code;
  }
  return String(error);
}

export function isCancelledError(error: unknown): boolean {
  return errorCode(error) === "CANCELLED" || errorMessage(error) === "CANCELLED";
}

export function isSegmentCountMismatch(error: unknown): boolean {
  return (
    errorCode(error) === "SEGMENT_COUNT_MISMATCH"
    || errorMessage(error) === "SEGMENT_COUNT_MISMATCH"
  );
}

export function isSkipOwnContent(error: unknown): boolean {
  return errorCode(error) === "SKIP_OWN_CONTENT" || errorMessage(error) === "SKIP_OWN_CONTENT";
}
