import { act, renderHook } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBallEvents } from "./useBallEvents";
import { useBallState } from "./useBallState";

type Listener = (event: { payload: unknown }) => void;
const mocks = vi.hoisted(() => ({ listeners: new Map<string, Listener>(), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, listener: Listener) => {
    mocks.listeners.set(name, listener);
    return Promise.resolve(() => {
      mocks.unlisten(name);
      if (mocks.listeners.get(name) === listener) mocks.listeners.delete(name);
    });
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => Promise.resolve(() => {}) }),
}));
vi.mock("../../hooks/useTheme", () => ({ useThemeSync: vi.fn() }));

const transitionMode = vi.fn().mockResolvedValue(undefined);
const scheduleStatusCollapse = vi.fn();
function useHarness({ clearPointerOrigin }: { clearPointerOrigin: () => void }) {
  const state = useBallState();
  useBallEvents({
    ...state, clearPointerOrigin, transitionMode, scheduleStatusCollapse,
    requestFocusCollapse: vi.fn(), cancelFocusCollapse: vi.fn(),
  });
  return state;
}
const event = (sourceId: string, state: string, revision: number, requestId = 1) =>
  ({ sourceId, state, revision, requestId });
function dispatch(payload: unknown) {
  act(() => { mocks.listeners.get("translation-state")!({ payload }); });
}

describe("useBallEvents activity aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
  });

  it("retains working sources and terminal revisions across real effect resubscriptions", async () => {
    const hook = renderHook(useHarness, { initialProps: { clearPointerOrigin: vi.fn() } });
    dispatch(event("main:A", "working", 1));
    dispatch(event("quick:B", "working", 1));
    await act(async () => { hook.rerender({ clearPointerOrigin: vi.fn() }); });
    expect(mocks.unlisten).toHaveBeenCalledWith("translation-state");
    expect(vi.mocked(listen).mock.calls.filter(([name]) => name === "translation-state")).toHaveLength(2);
    dispatch(event("main:A", "done", 2));
    expect(hook.result.current.phase).toBe("working");
    expect(transitionMode).toHaveBeenLastCalledWith("status", { reason: "business" });
    dispatch({ state: "idle" });
    expect(hook.result.current.phase).toBe("working");
    dispatch(event("quick:B", "done", 2));
    expect(hook.result.current.phase).toBe("done");
    await act(async () => { hook.rerender({ clearPointerOrigin: vi.fn() }); });
    const count = transitionMode.mock.calls.length;
    dispatch(event("main:A", "working", 1));
    dispatch(event("quick:B", "working", 1));
    dispatch(event("quick:B", "done", 2));
    expect(hook.result.current.phase).toBe("done");
    expect(transitionMode).toHaveBeenCalledTimes(count);
  });

  it.each(["done", "idle", "error"])("keeps full-window activity working until B reports %s", (terminal) => {
    const { result } = renderHook(useHarness, { initialProps: { clearPointerOrigin: vi.fn() } });
    result.current.modeRef.current = "full";
    dispatch(event("main:A", "working", 1));
    dispatch(event("quick:B", "working", 1));
    dispatch(event("main:A", terminal, 2, terminal === "idle" ? 2 : 1));
    expect(result.current.phase).toBe("working");
    expect(result.current.phaseRef.current).toBe("working");
    expect(transitionMode).not.toHaveBeenCalled();
    dispatch(event("quick:B", terminal, 2, terminal === "idle" ? 2 : 1));
    expect(result.current.phase).toBe(terminal);
    expect(result.current.phaseRef.current).toBe(terminal);
    expect(transitionMode).not.toHaveBeenCalled();
  });

  it("ignores malformed and stale events before mutating activity or transition state", () => {
    const { result } = renderHook(useHarness, { initialProps: { clearPointerOrigin: vi.fn() } });
    dispatch(event("main:A", "working", 3, 2));
    result.current.expectingTranslationRef.current = true;
    transitionMode.mockClear();
    dispatch({ ...event("main:A", "idle", 4, 2), revision: "4" });
    dispatch(event("main:A", "idle", 2, 2));
    dispatch(event("main:A", "idle", 5, 1));
    expect(result.current.expectingTranslationRef.current).toBe(true);
    expect(result.current.phase).toBe("working");
    expect(transitionMode).not.toHaveBeenCalled();
    dispatch(event("main:A", "idle", 4, 3));
    expect(result.current.expectingTranslationRef.current).toBe(false);
    expect(transitionMode).toHaveBeenCalledExactlyOnceWith("idle", { reason: "business" });
  });
});
