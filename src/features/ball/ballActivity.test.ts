import { describe, expect, it } from "vitest";
import { TranslationActivityAggregator } from "./ballActivity";

const event = (sourceId: string, state: string, revision: number, requestId = 1) =>
  ({ sourceId, state, revision, requestId });

describe("TranslationActivityAggregator", () => {
  it.each(["done", "idle", "error"])("keeps B working when A reports %s", (terminal) => {
    const activity = new TranslationActivityAggregator();
    expect(activity.accept(event("main:A", "working", 1))).toBe("working");
    expect(activity.accept(event("quick:B", "working", 1))).toBe("working");
    expect(activity.accept(event("main:A", terminal, 2))).toBe("working");
    expect(activity.accept(event("quick:B", terminal, 2))).toBe(terminal);
  });

  it("rejects duplicate revisions, old revisions and old requests without poisoning the cache", () => {
    const activity = new TranslationActivityAggregator();
    const working = event("main:A", "working", 3, 2);
    expect(activity.accept(working)).toBe("working");
    expect(activity.accept(working)).toBeNull();
    expect(activity.accept(event("main:A", "idle", 2, 2))).toBeNull();
    expect(activity.accept(event("main:A", "done", 100, 1))).toBeNull();
    expect(activity.accept(event("main:A", "done", 4, 2))).toBe("done");
  });

  it("does not revive a request when its done arrives before working", () => {
    const activity = new TranslationActivityAggregator();
    expect(activity.accept(event("main:A", "done", 2))).toBe("done");
    expect(activity.accept(event("main:A", "working", 1))).toBeNull();
    expect(activity.accept(event("main:A", "working", 3))).toBeNull();
    expect(activity.accept(event("main:A", "working", 3, 2))).toBe("working");
  });

  it("isolates remounted sources and keeps retired source tombstones", () => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("main:old", "working", 1));
    activity.accept(event("main:old", "idle", 2, 2));
    expect(activity.accept(event("main:new", "working", 1))).toBe("working");
    expect(activity.accept(event("main:old", "working", 1))).toBeNull();
    expect(activity.accept(event("main:old", "idle", 3, 2))).toBe("working");
    expect(activity.accept(event("main:new", "done", 2))).toBe("done");
  });

  it("accepts legacy payloads without letting anonymous terminal events hide known work", () => {
    const activity = new TranslationActivityAggregator();
    expect(activity.accept(true)).toBe("working");
    expect(activity.accept(false)).toBe("done");
    expect(activity.accept({ state: "idle" })).toBe("idle");
    activity.accept(event("main:A", "working", 1));
    for (const payload of [false, { state: "done" }, { state: "error" }, { state: "idle" }]) {
      expect(activity.accept(payload)).toBe("working");
    }
    expect(activity.accept(event("main:A", "done", 2))).toBe("done");
    expect(activity.accept(true)).toBe("working");
    expect(activity.accept(event("main:A", "idle", 3, 2))).toBe("idle");
    expect(activity.accept(false)).toBe("done");
  });

  it.each([
    { sourceId: "" }, { sourceId: "   " }, { sourceId: 12 }, { sourceId: null },
    { requestId: undefined }, { requestId: 0 }, { requestId: -1 }, { requestId: 1.5 }, { requestId: NaN },
    { requestId: Number.MAX_SAFE_INTEGER + 1 }, { revision: undefined }, { revision: 0 },
    { revision: -1 }, { revision: 1.5 }, { revision: Infinity }, { revision: "2" },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { state: "unknown" },
  ])("rejects invalid identities without changing activity: %j", (invalid) => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("main:A", "working", 1));
    expect(activity.accept({ ...event("main:A", "idle", 2), ...invalid })).toBeNull();
    expect(activity.accept({ state: "idle" })).toBe("working");
    expect(activity.accept(event("main:A", "done", 2))).toBe("done");
  });

  it("rejects partial identity rather than treating it as legacy", () => {
    const activity = new TranslationActivityAggregator();
    expect(activity.accept({ state: "working", sourceId: "main:A" })).toBeNull();
    expect(activity.accept({ state: "working", requestId: 1 })).toBeNull();
    expect(activity.accept({ state: "working", revision: 1 })).toBeNull();
    expect(activity.accept(null)).toBeNull();
    expect(activity.accept("working")).toBeNull();
    expect(activity.accept({ state: "idle" })).toBe("idle");
  });

  it("tracks the accepted event's source and leaves it null for anonymous payloads", () => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("main:A", "working", 1));
    expect(activity.lastAcceptedSourceId).toBe("main:A");
    activity.accept({ state: "done" });
    expect(activity.lastAcceptedSourceId).toBeNull();
    activity.accept(true);
    expect(activity.lastAcceptedSourceId).toBeNull();
    activity.accept(event("quick:B", "error", 1));
    expect(activity.lastAcceptedSourceId).toBe("quick:B");
    // Rejected stale events don't move the marker.
    activity.accept(event("quick:B", "idle", 1));
    expect(activity.lastAcceptedSourceId).toBe("quick:B");
  });

  it("clears a displayed result only for its own session's later events", () => {
    const activity = new TranslationActivityAggregator();
    const result = { source: "hi", text: "你好", direction: "en2zh" };
    activity.accept({ ...event("quick:B", "done", 2), result });
    expect(activity.completedResult?.sourceId).toBe("quick:B");
    expect(activity.accept(event("main:A", "idle", 1))).toBe("idle");
    expect(activity.completedResult?.sourceId).toBe("quick:B");
    expect(activity.accept({ state: "idle" })).toBe("idle");
    expect(activity.completedResult?.sourceId).toBe("quick:B");
    expect(activity.accept(event("quick:B", "idle", 3))).toBe("idle");
    expect(activity.completedResult).toBeNull();
  });

  it("records the error's source and message only on error activity", () => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("main:A", "working", 1));
    expect(activity.errorDetail).toEqual({ sourceId: null, message: null });
    activity.accept({ ...event("quick:B", "error", 1), message: " 连接超时 " });
    expect(activity.errorDetail).toEqual({ sourceId: "quick:B", message: "连接超时" });
    activity.accept({ ...event("main:A", "error", 2), error: "rate limited" });
    expect(activity.errorDetail).toEqual({ sourceId: "main:A", message: "rate limited" });
    activity.accept({ state: "error" });
    expect(activity.errorDetail).toEqual({ sourceId: null, message: null });
  });
});
