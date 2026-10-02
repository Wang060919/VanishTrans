import { type IslandPhase } from "../islandModel";
import { readTranslationResult, type IslandResult } from "../../lib/translationResult";

interface TranslationActivity {
  state?: string;
  sourceId?: unknown;
  requestId?: unknown;
  revision?: unknown;
  result?: unknown;
  message?: unknown;
  error?: unknown;
}

type Activity = IslandPhase | "idle";
interface SourceActivity { state: Activity; requestId: number; revision: number }
export interface IslandErrorDetail { sourceId: string | null; message: string | null }

/** Session scope the island's clipboard/screenshot actions funnel through. */
export const QUICK_SESSION_SCOPE = "quick:";

function readErrorMessage(event: TranslationActivity | null): string | null {
  for (const value of [event?.message, event?.error]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function normalizeTranslationActivity(payload: unknown): IslandPhase | "idle" | null {
  if (payload === true) return "working";
  if (payload === false) return "done";
  if (!payload || typeof payload !== "object") return null;
  const state = (payload as TranslationActivity).state;
  if (state === "working" || state === "done" || state === "error" || state === "idle") {
    return state;
  }
  return null;
}

/** Keep terminal revisions as tombstones so late working events cannot revive a source. */
export class TranslationActivityAggregator {
  completedResult: IslandResult | null = null;
  /** Displayed failure's source and message; null message falls back to generic copy. */
  errorDetail: IslandErrorDetail = { sourceId: null, message: null };
  /** Source of the latest accepted event; null for anonymous payloads. */
  lastAcceptedSourceId: string | null = null;
  private readonly sources = new Map<string, SourceActivity>();

  accept(payload: unknown): Activity | null {
    const state = normalizeTranslationActivity(payload);
    if (!state) return null;
    const event = typeof payload === "object" && payload !== null
      ? payload as TranslationActivity : null;
    let sourceId: string | null = null;
    let requestId = 0;
    let revision = 0;
    if (event && ("sourceId" in event || "requestId" in event || "revision" in event)) {
      const identified = event;
      if (typeof identified.sourceId !== "string" || !identified.sourceId.trim() ||
          typeof identified.requestId !== "number" || !Number.isSafeInteger(identified.requestId) || identified.requestId <= 0 ||
          typeof identified.revision !== "number" || !Number.isSafeInteger(identified.revision) || identified.revision <= 0) return null;
      sourceId = identified.sourceId;
      requestId = identified.requestId;
      revision = identified.revision;
      const previous = this.sources.get(sourceId);
      if (previous && (revision <= previous.revision || requestId < previous.requestId ||
          (requestId === previous.requestId && previous.state !== "working" && state === "working"))) {
        return null;
      }
      this.sources.set(sourceId, { state, requestId, revision });
    }
    this.lastAcceptedSourceId = sourceId;
    // Anonymous events retain legacy last-event semantics, but cannot hide known work.
    const activity = [...this.sources.values()].some((item) => item.state === "working") ? "working" : state;
    if (state === "error") {
      this.errorDetail = { sourceId, message: readErrorMessage(event) };
    }
    if (activity === "done" && sourceId !== null) {
      const snapshot = readTranslationResult(event?.result);
      this.completedResult = snapshot
        ? { ...snapshot, sourceId, requestId, revision }
        : null;
    } else if (sourceId !== null && this.completedResult?.sourceId === sourceId) {
      // Only a newer event from the result's own session supersedes it;
      // cross-source and anonymous events leave the displayed result alone.
      this.completedResult = null;
    }
    return activity;
  }
}
