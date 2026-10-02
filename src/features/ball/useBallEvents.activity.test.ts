import { act, renderHook } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBallEvents } from "./useBallEvents";
import { useBallState } from "./useBallState";

type Listener = (event: { payload: unknown }) => void;
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  unlisten: vi.fn(),
  focusChanged: undefined as ((event: { payload: boolean }) => void) | undefined,
}));
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
  getCurrentWindow: () => ({
    onFocusChanged: (listener: (event: { payload: boolean }) => void) => {
      mocks.focusChanged = listener;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("../../hooks/useTheme", () => ({ useThemeSync: vi.fn() }));
vi.mock("../../services/tauriBridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getForegroundWindowInfo: vi.fn(() => Promise.resolve(null)),
  logFrontendMessage: vi.fn(() => Promise.resolve()),
}));

const transitionMode = vi.fn().mockResolvedValue(undefined);
const scheduleStatusCollapse = vi.fn();
function useHarness({
  clearPointerOrigin,
  requestFocusCollapse = vi.fn(),
}: {
  clearPointerOrigin: () => void;
  requestFocusCollapse?: (motion?: "animated" | "instant") => void;
}) {
  const state = useBallState();
  useBallEvents({
    ...state, clearPointerOrigin, transitionMode, scheduleStatusCollapse,
    requestFocusCollapse, cancelFocusCollapse: vi.fn(),
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
    // A scoped expectation (e.g. runAction("clipboard") waiting on "quick:")
    // is not discharged by unrelated main-session events.
    result.current.expectingTranslationRef.current = "quick:";
    transitionMode.mockClear();
    dispatch({ ...event("main:A", "idle", 4, 2), revision: "4" });
    dispatch(event("main:A", "idle", 2, 2));
    dispatch(event("main:A", "idle", 5, 1));
    expect(result.current.expectingTranslationRef.current).toBe("quick:");
    expect(result.current.phase).toBe("working");
    expect(transitionMode).not.toHaveBeenCalled();
    dispatch(event("main:A", "idle", 4, 3));
    // Cross-source idle still resolves to "idle" business-wise, but the
    // quick-scoped expectation stays armed for its own session's event.
    expect(result.current.expectingTranslationRef.current).toBe("quick:");
    expect(transitionMode).toHaveBeenCalledExactlyOnceWith("idle", { reason: "business" });
    dispatch(event("quick:B", "working", 1, 5));
    expect(result.current.expectingTranslationRef.current).toBeNull();
    expect(transitionMode).toHaveBeenLastCalledWith("status", { reason: "business" });
  });

  it("ignores anonymous events while a quick-scoped expectation is armed", () => {
    const { result } = renderHook(useHarness, { initialProps: { clearPointerOrigin: vi.fn() } });
    result.current.expectingTranslationRef.current = "quick:";
    dispatch({ state: "idle" });
    dispatch({ state: "done" });
    expect(result.current.expectingTranslationRef.current).toBe("quick:");
    dispatch(event("quick:B", "done", 1));
    expect(result.current.expectingTranslationRef.current).toBeNull();
  });

  it("keeps the displayed result across anonymous and cross-source activity", () => {
    const { result } = renderHook(useHarness, { initialProps: { clearPointerOrigin: vi.fn() } });
    const snapshot = { source: "hello", text: "你好", direction: "en2zh" };
    dispatch({ ...event("quick:B", "done", 4, 2), result: snapshot });
    expect(result.current.resultRef.current?.sourceId).toBe("quick:B");
    dispatch({ state: "idle" });
    dispatch(event("main:A", "idle", 1));
    dispatch({ state: "done" });
    expect(result.current.resultRef.current?.sourceId).toBe("quick:B");
    // A newer event from the result's own session supersedes it.
    dispatch(event("quick:B", "working", 5, 6));
    expect(result.current.resultRef.current).toBeNull();
  });

  it("lets a busy main-action survive a native focus loss", () => {
    const requestFocusCollapse = vi.fn();
    const { result } = renderHook(useHarness, {
      initialProps: { clearPointerOrigin: vi.fn(), requestFocusCollapse },
    });
    result.current.modeRef.current = "actions";
    act(() => mocks.focusChanged?.({ payload: false }));
    // "actions" always requests the guarded collapse...
    expect(requestFocusCollapse).toHaveBeenCalledTimes(1);
    requestFocusCollapse.mockClear();
    // ...but while a "main" action is in flight the listener-side gate holds.
    result.current.busyActionRef.current = "main";
    act(() => mocks.focusChanged?.({ payload: false }));
    expect(requestFocusCollapse).not.toHaveBeenCalled();
    act(() => mocks.focusChanged?.({ payload: true }));
    act(() => mocks.focusChanged?.({ payload: false }));
    expect(requestFocusCollapse).not.toHaveBeenCalled();
    result.current.busyActionRef.current = null;
    act(() => mocks.focusChanged?.({ payload: false }));
    expect(requestFocusCollapse).toHaveBeenCalledTimes(1);
  });
});
