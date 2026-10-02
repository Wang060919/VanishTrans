import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBallState } from "./useBallState";
import { useBallFullPosition } from "./useBallFullPosition";

const mocks = vi.hoisted(() => ({
  outerPosition: vi.fn(() => Promise.resolve({ x: 700, y: 160 })),
  outerSize: vi.fn(() => Promise.resolve({ width: 560, height: 540 })),
  innerSize: vi.fn(() => Promise.resolve({ width: 560, height: 540 })),
  scaleFactor: vi.fn(() => Promise.resolve(1)),
  saveBallPosition: vi.fn((position: { x: number; y: number }) => Promise.resolve(position)),
}));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: vi.fn(() => Promise.resolve({
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    scaleFactor: 1,
  })),
  monitorFromPoint: vi.fn(() => Promise.resolve({
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    scaleFactor: 1,
  })),
  getCurrentWindow: () => ({
    outerPosition: mocks.outerPosition,
    outerSize: mocks.outerSize,
    innerSize: mocks.innerSize,
    scaleFactor: mocks.scaleFactor,
    setPosition: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
}));
vi.mock("./ballNative", () => ({
  IDLE_WIDTH: 116,
  IDLE_HEIGHT: 42,
  saveBallPosition: mocks.saveBallPosition,
}));
vi.mock("../../services/tauriBridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logFrontendMessage: vi.fn(() => Promise.resolve()),
}));

function useHarness() {
  const state = useBallState();
  const position = useBallFullPosition(state);
  return { state, position };
}

describe("useBallFullPosition anchor writes", () => {
  afterEach(() => vi.clearAllMocks());

  it("persists the measured anchor while the window is still full", async () => {
    const { result } = renderHook(useHarness);
    result.current.state.modeRef.current = "full";
    await result.current.position.handleFullWindowMoved();
    expect(mocks.saveBallPosition).toHaveBeenCalledWith(
      { x: 922, y: 160 },
      false,
    );
    expect(result.current.state.anchorPositionRef.current).toEqual({ x: 922, y: 160 });
  });

  it("skips the write when a collapse ran while the move IPC was in flight", async () => {
    const { result } = renderHook(useHarness);
    result.current.state.modeRef.current = "full";
    result.current.state.anchorPositionRef.current = { x: 100, y: 50 };
    let finishMeasure: (() => void) | undefined;
    mocks.outerPosition.mockImplementationOnce(() => new Promise((resolve) => {
      finishMeasure = () => resolve({ x: 700, y: 160 });
    }));
    const pending = result.current.position.handleFullWindowMoved();
    // A queued collapse owns the anchor now; the stale drag result must not win.
    result.current.state.modeRef.current = "idle";
    finishMeasure?.();
    await pending;
    expect(mocks.saveBallPosition).not.toHaveBeenCalled();
    expect(result.current.state.anchorPositionRef.current).toEqual({ x: 100, y: 50 });
  });
});
