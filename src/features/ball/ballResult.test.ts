import { describe, expect, it } from "vitest";
import { TranslationActivityAggregator } from "./ballActivity";

const result = { source: "hello", text: "你好", direction: "en2zh" };
const event = (state: string, revision: number, requestId = 1, sourceId = "quick:A") =>
  ({ state, revision, requestId, sourceId, result });

describe("island result identity", () => {
  it("retains the accepted result when duplicate or old events arrive", () => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("done", 4, 2));
    const accepted = activity.completedResult;
    expect(accepted).toEqual({ ...result, sourceId: "quick:A", requestId: 2, revision: 4 });
    expect(activity.accept(event("done", 3, 2))).toBeNull();
    expect(activity.accept(event("done", 5, 1))).toBeNull();
    expect(activity.completedResult).toBe(accepted);
  });
  it.each(["working", "idle", "error"])("invalidates the result when a new request becomes %s", (state) => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("done", 2));
    activity.accept(event(state, 3, 2));
    expect(activity.completedResult).toBeNull();
    activity.accept(event("done", 2));
    expect(activity.completedResult).toBeNull();
  });
  it("does not offer A's result while B is still translating", () => {
    const activity = new TranslationActivityAggregator();
    activity.accept(event("working", 1));
    activity.accept(event("working", 1, 1, "main:B"));
    expect(activity.accept(event("done", 2))).toBe("working");
    expect(activity.completedResult).toBeNull();
    expect(activity.accept(event("done", 2, 1, "main:B"))).toBe("done");
    expect(activity.completedResult?.sourceId).toBe("main:B");
  });
  it.each([undefined, {}, { ...result, source: " " }, { ...result, text: 42 },
    { ...result, direction: "invalid" }])("rejects invalid snapshots without inventing results: %j", (invalid) => {
    const activity = new TranslationActivityAggregator();
    expect(activity.accept({ ...event("done", 2), result: invalid })).toBe("done");
    expect(activity.completedResult).toBeNull();
  });
  it("does not trust unversioned result payloads", () => {
    const activity = new TranslationActivityAggregator();
    expect(activity.accept({ state: "done", result })).toBe("done");
    expect(activity.completedResult).toBeNull();
  });
});
