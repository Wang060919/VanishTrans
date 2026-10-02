import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIslandPreviewMotion } from "./useIslandPreviewMotion";
import { ISLAND_TIMING } from "./islandModel";

describe("useIslandPreviewMotion", () => {
  afterEach(() => vi.useRealTimers());

  it("commits non-exit transitions immediately", () => {
    const { result } = renderHook(() => useIslandPreviewMotion("idle", true));
    act(() => result.current.setMode("actions"));
    expect(result.current.mode).toBe("actions");
    expect(result.current.phase).toBe("stable");
  });

  it("evaluates the pending target when a retarget lands mid full-exit", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIslandPreviewMotion("full", true));

    act(() => result.current.setMode("idle"));
    expect(result.current.phase).toBe("full-exit");
    expect(result.current.mode).toBe("full");

    // A second request during the exit resolves against the pending "idle",
    // not the still-rendered "full" — so "status" commits without replaying
    // another full-exit cycle.
    act(() => result.current.setMode("status"));
    expect(result.current.mode).toBe("status");
    expect(result.current.phase).toBe("stable");

    act(() => vi.advanceTimersByTime(ISLAND_TIMING.fullContentExitMs + 50));
    expect(result.current.mode).toBe("status");
    expect(result.current.phase).toBe("stable");
  });

  it("plays full-exit once when leaving full", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIslandPreviewMotion("full", true));
    act(() => result.current.setMode("idle"));
    expect(result.current.phase).toBe("full-exit");
    act(() => vi.advanceTimersByTime(ISLAND_TIMING.fullContentExitMs + 1));
    expect(result.current.mode).toBe("idle");
    expect(result.current.phase).toBe("stable");
  });
});
