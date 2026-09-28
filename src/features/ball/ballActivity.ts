import { type IslandPhase } from "../islandModel";

interface TranslationActivity {
  state?: string;
  sourceId?: unknown;
  requestId?: unknown;
  revision?: unknown;
}

type Activity = IslandPhase | "idle";
interface SourceActivity { state: Activity; requestId: number; revision: number }

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
  private readonly sources = new Map<string, SourceActivity>();

  accept(payload: unknown): Activity | null {
    const state = normalizeTranslationActivity(payload);
    if (!state) return null;
    const event = typeof payload === "object" && payload !== null
      ? payload as TranslationActivity : null;
    const identified = event && ("sourceId" in event || "requestId" in event || "revision" in event);
    if (identified) {
      const { sourceId, requestId, revision } = event;
      if (typeof sourceId !== "string" || !sourceId.trim() ||
          typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId <= 0 ||
          typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) return null;
      const previous = this.sources.get(sourceId);
      if (previous && (revision <= previous.revision || requestId < previous.requestId ||
          (requestId === previous.requestId && previous.state !== "working" && state === "working"))) {
        return null;
      }
      this.sources.set(sourceId, { state, requestId, revision });
    }
    // Anonymous events retain legacy last-event semantics, but cannot hide known work.
    return [...this.sources.values()].some((item) => item.state === "working") ? "working" : state;
  }
}
