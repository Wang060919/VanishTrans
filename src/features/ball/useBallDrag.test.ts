import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBallState } from "./useBallState";
import { useBallDrag } from "./useBallDrag";
import { type IslandTransitionRequest } from "../islandTransitionCoordinator";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    outerSize: () => Promise.resolve({ width: 116, height: 42 }),
    innerSize: () => Promise.resolve({ width: 116, height: 42 }),
    scaleFactor: () => Promise.resolve(1),
  }),
}));
vi.mock("../../services/tauriBridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startWindowDragging: vi.fn(() => Promise.resolve()),
  logFrontendMessage: vi.fn(() => Promise.resolve()),
}));

const pointerEvent = (target: Element, x: number, y: number) => ({
  button: 0,
  clientX: x,
  clientY: y,
  pointerId: 1,
  target,
  currentTarget: target,
}) as unknown as React.PointerEvent<HTMLElement>;

/** Park a never-resolving transition so isTransitioning is true. */
function holdTransition(state: ReturnType<typeof useBallState>) {
  const request: IslandTransitionRequest = { target: "actions", motion: "instant", reason: "user" };
  void state.transitionCoordinator.request(request, () => new Promise<void>(() => {}));
}

describe("useBallDrag pointer origin hygiene", () => {
  afterEach(() => vi.clearAllMocks());

  it("drops the press origin on moves ignored while transitioning", () => {
    const { result } = renderHook(() => {
      const state = useBallState();
      const drag = useBallDrag({ ...state, scheduleStatusCollapse: vi.fn() });
      return { state, drag };
    });
    const surface = document.createElement("div");
    result.current.state.modeRef.current = "idle";

    result.current.drag.handlePointerDown(pointerEvent(surface, 10, 10));
    expect(result.current.state.pointerOriginRef.current).not.toBeNull();

    holdTransition(result.current.state);
    result.current.drag.handlePointerMove(pointerEvent(surface, 20, 10));
    expect(result.current.state.pointerOriginRef.current).toBeNull();
    expect(result.current.state.draggingRef.current).toBe(false);
  });

  it("a press refused mid-transition leaves no origin to measure from", () => {
    const { result } = renderHook(() => {
      const state = useBallState();
      const drag = useBallDrag({ ...state, scheduleStatusCollapse: vi.fn() });
      return { state, drag };
    });
    const surface = document.createElement("div");
    result.current.state.modeRef.current = "idle";
    holdTransition(result.current.state);

    result.current.drag.handlePointerDown(pointerEvent(surface, 10, 10));
    expect(result.current.state.pointerOriginRef.current).toBeNull();
    result.current.drag.handlePointerMove(pointerEvent(surface, 40, 10));
    expect(result.current.state.draggingRef.current).toBe(false);
  });
});
