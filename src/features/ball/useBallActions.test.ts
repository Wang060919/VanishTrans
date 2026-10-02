import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBallActions } from "./useBallActions";
import { useBallState } from "./useBallState";
import type { BallTransitions } from "./useBallTransitions";

const { invokeCommand } = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("./ballNative", () => ({ invokeCommand }));

function setup(transitionMode: BallTransitions["transitionMode"]) {
  return renderHook(() => {
    const state = useBallState();
    const actions = useBallActions({
      ...state, transitionMode, requestFocusCollapse: vi.fn(),
    });
    return { state, actions };
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("error status click", () => {
  it("surfaces a quick-session error in the island instead of the empty workspace", async () => {
    const transitionMode = vi.fn<BallTransitions["transitionMode"]>().mockResolvedValue();
    const { result } = setup(transitionMode);
    result.current.state.modeRef.current = "status";
    result.current.state.statusErrorRef.current = {
      sourceId: "quick:B",
      message: "连接超时",
    };
    await act(async () => {
      result.current.state.setPhase("error");
    });
    await act(async () => { await result.current.actions.handleCoreClick(); });
    expect(transitionMode).toHaveBeenCalledWith("actions");
    expect(transitionMode).not.toHaveBeenCalledWith("full");
    expect(result.current.state.notice).toBe("连接超时");
  });

  it.each([
    { sourceId: null, label: "anonymous" },
    { sourceId: "main:A", label: "main-session" },
  ])("routes a $label error to the full workspace", async ({ sourceId }) => {
    const transitionMode = vi.fn<BallTransitions["transitionMode"]>().mockResolvedValue();
    const { result } = setup(transitionMode);
    result.current.state.modeRef.current = "status";
    result.current.state.statusErrorRef.current = { sourceId, message: "boom" };
    await act(async () => {
      result.current.state.setPhase("error");
    });
    await act(async () => { await result.current.actions.handleCoreClick(); });
    expect(transitionMode).toHaveBeenCalledWith("full");
    expect(result.current.state.notice).toBe("");
  });
});

describe("screenshot action lifecycle", () => {
  it("waits for the instant collapse before allowing the native command to hide the island", async () => {
    let finishCollapse: (() => void) | undefined;
    const transitionMode = vi.fn<BallTransitions["transitionMode"]>(() => new Promise<void>((resolve) => {
      finishCollapse = resolve;
    }));
    invokeCommand.mockResolvedValue(undefined);
    const { result } = setup(transitionMode);
    let action: Promise<void> | undefined;

    act(() => {
      action = result.current.actions.runAction("screenshot", "start_screenshot_from_ball");
    });
    expect(transitionMode).toHaveBeenCalledWith("idle", { motion: "instant", reason: "business" });
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(result.current.state.busyAction).toBe("screenshot");

    await act(async () => {
      finishCollapse?.();
      await action;
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_screenshot_from_ball");
    // No second animation may be queued once the native window is hidden.
    expect(transitionMode).toHaveBeenCalledTimes(1);
    expect(result.current.state.busyAction).toBeNull();
  });

  it("restores the action strip with an error notice if screenshot startup fails", async () => {
    vi.useFakeTimers();
    const transitionMode = vi.fn<BallTransitions["transitionMode"]>().mockResolvedValue();
    invokeCommand.mockRejectedValue(new Error("截图启动失败"));
    const { result } = setup(transitionMode);

    await act(async () => {
      await result.current.actions.runAction("screenshot", "start_screenshot_from_ball");
    });
    expect(transitionMode).toHaveBeenNthCalledWith(1, "idle", { motion: "instant", reason: "business" });
    expect(transitionMode).toHaveBeenNthCalledWith(2, "actions", { motion: "instant", reason: "business" });
    expect(result.current.state.notice).toBe("截图启动失败");
    expect(result.current.state.busyAction).toBeNull();
    await act(async () => { await vi.runAllTimersAsync(); });
  });
});
