import { describe, expect, it, vi, afterEach } from "vitest";
import { rollbackIslandToIdle } from "./ballRollback";
import { type IslandMode } from "../islandModel";

const mocks = vi.hoisted(() => ({
  outerPosition: vi.fn(() => Promise.resolve({ x: 640, y: 12 })),
  scaleFactor: vi.fn(() => Promise.resolve(1.5)),
  setBallWindowBounds: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerPosition: mocks.outerPosition,
    scaleFactor: mocks.scaleFactor,
  }),
}));
vi.mock("./ballNative", () => ({
  IDLE_WIDTH: 116,
  IDLE_HEIGHT: 42,
  setBallWindowBounds: mocks.setBallWindowBounds,
}));
vi.mock("../../services/tauriBridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logFrontendMessage: vi.fn(() => Promise.resolve()),
}));

const refs = () => ({
  nativeModeRef: { current: "full" as IslandMode },
  nativeTargetModeRef: { current: "actions" as IslandMode },
  anchorPositionRef: { current: null as { x: number; y: number } | null },
});

describe("rollbackIslandToIdle", () => {
  afterEach(() => vi.clearAllMocks());

  it("restores idle bounds at the stored anchor", async () => {
    const state = refs();
    state.anchorPositionRef.current = { x: 300, y: 40 };
    await rollbackIslandToIdle(state);
    expect(mocks.setBallWindowBounds).toHaveBeenCalledWith(
      { x: 300, y: 40, width: 174, height: 63 },
    );
    expect(state.nativeModeRef.current).toBe("idle");
    expect(state.nativeTargetModeRef.current).toBe("idle");
  });

  it("reconciles native refs even without a stored anchor (first-expand failure)", async () => {
    const state = refs();
    await rollbackIslandToIdle(state);
    // Falls back to the live window position instead of skipping the rollback.
    expect(mocks.setBallWindowBounds).toHaveBeenCalledWith(
      { x: 640, y: 12, width: 174, height: 63 },
    );
    expect(state.nativeModeRef.current).toBe("idle");
    expect(state.nativeTargetModeRef.current).toBe("idle");
  });

  it("stops advertising an unapplied target when the rollback IPC also fails", async () => {
    const state = refs();
    mocks.setBallWindowBounds.mockRejectedValueOnce(new Error("native down"));
    await rollbackIslandToIdle(state);
    expect(state.nativeTargetModeRef.current).toBe("full");
    expect(state.nativeModeRef.current).toBe("full");
  });
});
