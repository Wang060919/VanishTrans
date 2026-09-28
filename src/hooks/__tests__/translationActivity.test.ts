import { act, renderHook, waitFor } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationSession } from "../useTranslationSession";
import { useQuickTranslation } from "../useQuickTranslation";
import { TranslationActivityAggregator } from "../../features/ball/ballActivity";

const bridge = vi.hoisted(() => ({
  quickFrontendReady: vi.fn().mockResolvedValue(undefined),
  reserveQuickRequest: vi.fn().mockResolvedValue(1),
  revealQuickResult: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../services/tauriBridge", () => bridge);
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));
interface ActivityEvent { state: string; sourceId: string; requestId: number; revision: number }
const events = () => vi.mocked(emit).mock.calls.filter(([name]) => name === "translation-state")
  .map(([, payload]) => payload as ActivityEvent);
const lastEvent = () => events().at(-1)!;

describe("production session activity broadcasts", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["done", "cancel", "reset", "unmount"] as const)(
    "keeps B working after A %s until B finishes", (ending) => {
      const a = renderHook(() => useTranslationSession());
      const b = renderHook(() => useTranslationSession(0, undefined, "quick"));
      const activity = new TranslationActivityAggregator();
      let aId = 0, bId = 0;
      act(() => { aId = a.result.current.begin("text"); });
      const aWorking = lastEvent();
      expect(activity.accept(aWorking)).toBe("working");
      act(() => { bId = b.result.current.begin("text"); });
      expect(activity.accept(lastEvent())).toBe("working");
      expect(lastEvent().sourceId).not.toBe(aWorking.sourceId);
      act(() => {
        if (ending === "done") a.result.current.complete(aId, "A");
        else if (ending === "unmount") a.unmount();
        else a.result.current[ending]();
      });
      expect(activity.accept(lastEvent())).toBe("working");
      const aTerminal = lastEvent();
      expect(aTerminal.sourceId).toBe(aWorking.sourceId);
      expect(aTerminal.revision).toBeGreaterThan(aWorking.revision);
      expect(activity.accept(aWorking)).toBeNull();
      act(() => { b.result.current.complete(bId, "B"); });
      expect(activity.accept(lastEvent())).toBe("done");
      expect(activity.accept(aTerminal)).toBeNull();
      b.unmount();
      expect(activity.accept(lastEvent())).toBe("idle");
    },
  );

  it("uses one identified monotonic stream for every session exit path", () => {
    const session = renderHook(() => useTranslationSession());
    let requestId = 0;
    act(() => { requestId = session.result.current.begin("stream"); });
    act(() => session.result.current.complete(requestId, "done"));
    act(() => { requestId = session.result.current.begin("file"); });
    act(() => session.result.current.fail(requestId, new Error("failed")));
    act(() => { requestId = session.result.current.begin("text"); });
    act(() => session.result.current.fail(requestId, { code: "CANCELLED", message: "cancelled" }));
    act(() => session.result.current.cancel());
    act(() => session.result.current.reset());
    act(() => session.result.current.reset("reset error"));
    act(() => { expect(session.result.current.applyExternalResult({
      source: "external", text: "translated", requestSeq: 1,
    })).toBe(true); });
    session.rerender();
    session.unmount();
    const sent = events();
    expect(sent.map(({ state }) => state)).toEqual([
      "working", "done", "working", "error", "working", "idle",
      "idle", "idle", "error", "done", "idle",
    ]);
    expect(new Set(sent.map(({ sourceId }) => sourceId)).size).toBe(1);
    expect(sent[0].sourceId).toMatch(/^main:[0-9a-f-]{36}$/);
    expect(sent.map(({ revision }) => revision)).toEqual(sent.map((_, index) => index + 1));
    expect(sent.every(({ requestId }) => Number.isSafeInteger(requestId))).toBe(true);
    expect(sent.map(({ requestId }) => requestId)).toEqual([1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8]);
  });

  it("isolates remounts and rejects reverse-delivered production events", () => {
    const old = renderHook(() => useTranslationSession());
    let requestId = 0;
    act(() => { requestId = old.result.current.begin("text"); });
    const working = lastEvent();
    act(() => old.result.current.complete(requestId, "done"));
    const done = lastEvent();
    const activity = new TranslationActivityAggregator();
    expect(activity.accept(done)).toBe("done");
    expect(activity.accept(working)).toBeNull();
    old.unmount();
    const unmounted = lastEvent();
    expect(activity.accept(unmounted)).toBe("idle");
    const fresh = renderHook(() => useTranslationSession());
    act(() => { fresh.result.current.begin("text"); });
    expect(lastEvent().sourceId).not.toBe(working.sourceId);
    expect(lastEvent().revision).toBe(1);
    expect(activity.accept(lastEvent())).toBe("working");
    expect(activity.accept(unmounted)).toBeNull();
    expect(activity.accept({ state: "idle" })).toBe("working");
  });

  it("does not broadcast stale results or duplicate completions", () => {
    const session = renderHook(() => useTranslationSession());
    let first = 0, second = 0;
    act(() => { first = session.result.current.begin("text"); });
    act(() => { second = session.result.current.begin("text"); });
    act(() => {
      session.result.current.complete(first, "old");
      session.result.current.fail(first, "old");
      session.result.current.complete(second, "new");
      session.result.current.complete(second, "duplicate");
    });
    expect(events().map(({ state }) => state)).toEqual(["working", "working", "done"]);
  });

  it("gives the real quick hook its scope and only one identified unmount broadcast", async () => {
    const main = renderHook(() => useTranslationSession());
    const quick = renderHook(useQuickTranslation);
    await waitFor(() => expect(bridge.quickFrontendReady).toHaveBeenCalledWith(true));
    act(() => { main.result.current.begin("text"); });
    const mainEvent = lastEvent();
    await act(async () => { quick.result.current.begin("text"); });
    const quickEvent = lastEvent();
    expect(quickEvent.sourceId).toMatch(/^quick:[0-9a-f-]{36}$/);
    expect(quickEvent.sourceId).not.toBe(mainEvent.sourceId);
    quick.rerender();
    expect(lastEvent()).toBe(quickEvent);
    const before = events().length;
    quick.unmount();
    expect(events()).toHaveLength(before + 1);
    expect(lastEvent()).toEqual({ state: "idle", sourceId: quickEvent.sourceId,
      requestId: quickEvent.requestId + 1, revision: quickEvent.revision + 1 });
    const activity = new TranslationActivityAggregator();
    expect(activity.accept(mainEvent)).toBe("working");
    expect(activity.accept(quickEvent)).toBe("working");
    expect(activity.accept(lastEvent())).toBe("working");
  });
});
