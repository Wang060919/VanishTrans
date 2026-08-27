import { logFrontendMessage } from '../services/tauriBridge';

export type LogLevel = "info" | "warn" | "error";

const MAX_DETAIL_LENGTH = 2048;

function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  const raw =
    detail instanceof Error
      ? (detail.stack ?? detail.message)
      : typeof detail === "string"
        ? detail
        : (() => {
            try {
              return JSON.stringify(detail);
            } catch {
              return String(detail);
            }
          })();
  return raw.length > MAX_DETAIL_LENGTH ? `${raw.slice(0, MAX_DETAIL_LENGTH)}...(truncated)` : raw;
}

/**
 * Report an operational error so it surfaces both in the browser devtools and
 * in the Rust log (env_logger), instead of leaking only to the console.
 * Never throws: logging must not break the flow that failed.
 */
export function logError(context: string, message: string, detail?: unknown): void {
  const serialized = serializeDetail(detail);
  const line = `[${context}] ${message}${serialized ? `: ${serialized}` : ""}`;
  console.error(line);
  void logFrontendMessage({ level: "error", message: line }).catch(() => {});
}
