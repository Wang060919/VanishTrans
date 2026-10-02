import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBallState } from "./useBallState";
import { useBallTransitions } from "./useBallTransitions";

const mocks = vi.hoisted(() => ({
  focused: true as boolean,
  hold: false as boolean,
  runBallTransition: vi.fn((_state: unknown, _request: { target: string }) =>
    mocks.hold ? new Promise<void>(() => {}) : Promise.resolve()),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: () => Promise.resolve(mocks.focused),
  }),
}));
vi.mock("../../services/tauriBridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getForegroundWindowInfo: vi.fn(() => Promise.resolve(null)),
  logFrontendMessage: vi.fn(() => Promise.resolve()),
}));
vi.mock("./ballTransition", () => ({
  runBallTransition: mocks.runBallTransition,
}));

function useHarness() {
  const state = useBallState();
  const transitions = useBallTransitions(state);
  return { state, transitions };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.focused = true;
  mocks.hold = false;
});

describe("transitionSettledAtRef", () => {
  it("stamps only when a task actually ran, never for displaced pending requests", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useHarness);
    const coordinator = result.current.state.transitionCoordinator;
    coordinator.setPaused(true);
    const first = result.current.transitions.transitionMode("actions");
    const second = result.current.transitions.transitionMode("idle");
    // The displaced task's promise resolves while paused without executing.
    await act(async () => {
      await first;
      expect(result.current.state.transitionSettledAtRef.current).toBe(Number.NEGATIVE_INFINITY);
    });
    coordinator.setPaused(false);
    await act(async () => { await second; });
    expect(mocks.runBallTransition).toHaveBeenCalledTimes(1);
    expect(result.current.state.transitionSettledAtRef.current)
      .toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });
});

describe("requestFocusCollapse guards", () => {
  it("does not collapse while an action is busy, then honors a fresh blur", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useHarness);
    mocks.focused = false;
    result.current.state.modeRef.current = "result";
    result.current.state.busyActionRef.current = "main";
    result.current.transitions.requestFocusCollapse("instant");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.runBallTransition).not.toHaveBeenCalled();

    result.current.state.busyActionRef.current = null;
    result.current.transitions.requestFocusCollapse("instant");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.runBallTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ target: "idle" }),
      expect.anything(),
    );
  });

  it.each(["actions", "result"] as const)(
    "vetoes a queued collapse while a matching guard is active (%s)",
    async (mode) => {
      vi.useFakeTimers();
      const { result } = renderHook(useHarness);
      const coordinator = result.current.state.transitionCoordinator;
      mocks.focused = false;
      mocks.hold = true;
      result.current.state.modeRef.current = mode;
      // The actions branch also respects an in-flight transition; the result
      // branch vetoes on a busy action or visible notice.
      if (mode === "actions") {
        void result.current.transitions.transitionMode("actions");
      } else {
        result.current.state.busyActionRef.current = "main";
      }
      result.current.transitions.requestFocusCollapse("instant");
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(coordinator.requestedTarget).not.toBe("idle");
    },
  );

  it("still lets a blur collapse supersede an in-flight expansion", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useHarness);
    const coordinator = result.current.state.transitionCoordinator;
    mocks.focused = false;
    mocks.hold = true;
    result.current.state.modeRef.current = "full";
    void result.current.transitions.transitionMode("full");
    result.current.transitions.requestFocusCollapse("instant");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(coordinator.requestedTarget).toBe("idle");
  });
});
