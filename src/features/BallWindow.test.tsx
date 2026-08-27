import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import BallWindow, { normalizeTranslationActivity } from "./BallWindow";

type Listener = (event: { payload: unknown }) => void;
type FocusChangedListener = (event: { payload: boolean }) => void;
type NativeBounds = { x: number; y: number; width: number; height: number };

const listeners: Record<string, Listener> = {};
let focusChangedListener: FocusChangedListener | undefined;
let nativeSize = { width: 116, height: 42 };
let nativePosition = { x: 902, y: 0 };
let nativeScale = 1;
let nativeMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: {
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1040 },
  },
  scaleFactor: 1,
};
const mocks = vi.hoisted(() => ({
  invoke: vi.fn((_command: string, _args?: Record<string, unknown>): Promise<unknown> => Promise.resolve()),
}));

const setBallWindowBounds = vi.fn((bounds: NativeBounds) => {
  nativePosition = { x: bounds.x, y: bounds.y };
  nativeSize = { width: bounds.width, height: bounds.height };
});

const setSize = vi.fn(async (size: { width: number; height: number }) => {
  nativeSize = { width: size.width, height: size.height };
});
const setPosition = vi.fn(async (position: { x: number; y: number }) => {
  nativePosition = { x: position.x, y: position.y };
});
const setFocus = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());
const onFocusChanged = vi.fn((listener: FocusChangedListener) => {
  focusChangedListener = listener;
  return Promise.resolve(() => {});
});

function defaultInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  if (command === "set_ball_window_bounds") {
    setBallWindowBounds(args as NativeBounds);
    return Promise.resolve();
  }
  if (command === "save_ball_position") {
    return Promise.resolve([args?.x, args?.y]);
  }
  if (command === "get_api_config") {
    return Promise.resolve({
      baseUrl: "https://api.openai.com",
      hasApiKey: false,
      model: "gpt-4o-mini",
    });
  }
  if (command === "get_pin_state") return Promise.resolve(false);
  return Promise.resolve();
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn((name: string, listener: Listener) => {
    listeners[name] = listener;
    return Promise.resolve(() => delete listeners[name]);
  }),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: vi.fn(() => Promise.resolve(nativeMonitor)),
  monitorFromPoint: vi.fn(() => Promise.resolve(nativeMonitor)),
  getCurrentWindow: vi.fn(() => ({
    label: "ball",
    scaleFactor: () => Promise.resolve(nativeScale),
    outerPosition: () => Promise.resolve(nativePosition),
    outerSize: () => Promise.resolve(nativeSize),
    innerSize: () => Promise.resolve(nativeSize),
    setSize,
    setPosition,
    setFocus,
    startDragging,
    onFocusChanged,
  })),
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: vi.fn(() => ({ theme: "dark", setTheme: vi.fn() })),
  useThemeSync: vi.fn(),
}));

function dispatchTranslationState(payload: unknown) {
  listeners["translation-state"]?.({ payload });
}

function getIsland() {
  return screen.getByLabelText("VanishTrans 快速工具");
}

function getSurface() {
  return document.querySelector(".translation-island__surface");
}

async function advanceTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("normalizeTranslationActivity", () => {
  it("accepts structured states and legacy boolean payloads", () => {
    expect(normalizeTranslationActivity({ state: "working" })).toBe("working");
    expect(normalizeTranslationActivity({ state: "done" })).toBe("done");
    expect(normalizeTranslationActivity({ state: "error" })).toBe("error");
    expect(normalizeTranslationActivity({ state: "idle" })).toBe("idle");
    expect(normalizeTranslationActivity(true)).toBe("working");
    expect(normalizeTranslationActivity(false)).toBe("done");
    expect(normalizeTranslationActivity({ state: "unknown" })).toBeNull();
    expect(normalizeTranslationActivity("working")).toBeNull();
  });
});

describe("BallWindow", () => {
  beforeEach(() => {
    focusChangedListener = undefined;
    nativeSize = { width: 116, height: 42 };
    nativePosition = { x: 902, y: 0 };
    nativeScale = 1;
    nativeMonitor = {
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1040 },
      },
      scaleFactor: 1,
    };
    setBallWindowBounds.mockClear();
    setSize.mockClear();
    setPosition.mockClear();
    setFocus.mockClear();
    startDragging.mockClear();
    onFocusChanged.mockClear();
    mocks.invoke.mockClear();
    mocks.invoke.mockImplementation(defaultInvoke);
    for (const name of Object.keys(listeners)) delete listeners[name];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps transitions active after StrictMode replays mount effects", async () => {
    render(
      <StrictMode>
        <BallWindow />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));

    expect(await screen.findByRole("button", { name: "主界面" })).toBeInTheDocument();
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
  });

  it("expands the idle capsule into the integrated action island", async () => {
    render(<BallWindow />);

    expect(document.querySelector(".translation-island__surface")).toHaveAttribute("data-mode", "idle");
    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));

    expect(await screen.findByRole("button", { name: "剪贴板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "截图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主界面" })).toBeInTheDocument();
    expect(document.querySelector(".translation-island__surface")).toHaveAttribute("data-mode", "actions");
    expect(getIsland()).toHaveClass("translation-island--center");
    expect(getSurface()).toHaveStyle({ transformOrigin: "50% 0%" });
    expect(getIsland().style.getPropertyValue("--island-width")).toBe("296px");
    expect(getIsland().style.getPropertyValue("--island-height")).toBe("60px");
    expect(getIsland().style.getPropertyValue("--island-radius")).toBe("30px");
    const actionsContent = document.querySelector(".translation-island__content--actions");
    expect(actionsContent).toBeInTheDocument();
    await waitFor(() => {
      const width = parseFloat(getComputedStyle(actionsContent!).width);
      expect(width).toBeCloseTo(238, 0);
    });
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 812, y: 0, width: 296, height: 60 });
    expect(setSize).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
    expect(setFocus).toHaveBeenCalled();
  });

  it("starts the visual morph after the native bounds are ready", async () => {
    let finishBounds: (() => void) | undefined;
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "set_ball_window_bounds") {
        setBallWindowBounds(args as NativeBounds);
        return new Promise((resolve) => {
          finishBounds = () => resolve(undefined);
        });
      }
      return defaultInvoke(command, args);
    });
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));

    await waitFor(() => expect(finishBounds).toBeDefined());
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(setFocus).not.toHaveBeenCalled();

    await act(async () => finishBounds?.());
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "actions"));
    await waitFor(() => expect(setFocus).toHaveBeenCalled());
  });

  it("finishes the CSS collapse before snapping the native window bounds", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    setBallWindowBounds.mockClear();
    mocks.invoke.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "收起快速工具" }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    // The full wordmark returns immediately (2eb538e) so the label fades back
    // in sync with the surface collapse instead of reappearing after it.
    expect(document.querySelector(".translation-island__core .brand-wordmark")).toBeInTheDocument();
    expect(setBallWindowBounds).not.toHaveBeenCalled();

    await advanceTimers(279);
    expect(setBallWindowBounds).not.toHaveBeenCalled();

    await advanceTimers(1);
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 902, y: 0, width: 116, height: 42 });
    expect(mocks.invoke).toHaveBeenCalledWith("set_ball_window_bounds", {
      x: 902,
      y: 0,
      width: 116,
      height: 42,
    });
    expect(document.querySelector(".translation-island__core .brand-wordmark")).toBeInTheDocument();
  });

  it("uses the instant presentation when the expanded actions lose DOM focus", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await screen.findByRole("button", { name: "主界面" });

    fireEvent.blur(getIsland(), { relatedTarget: null });

    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "idle"));
    expect(getIsland()).toHaveClass("translation-island--instant");
    expect(screen.queryByRole("button", { name: "主界面" })).not.toBeInTheDocument();
  });

  it("keeps the native actions surface stable when window focus is lost", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    await advanceTimers(0);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    setBallWindowBounds.mockClear();
    mocks.invoke.mockClear();

    act(() => focusChangedListener?.({ payload: false }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    // Window focus loss now plays the animated collapse (f00cb7d) rather than
    // snapping instantly, and the fixed-region optimization was removed
    // (b837872), so the native bounds follow after the CSS animation.
    expect(getIsland()).not.toHaveClass("translation-island--instant");

    await advanceTimers(279);
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(
      expect.objectContaining({ width: 116, height: 42 }),
    );

    await advanceTimers(1);
    expect(mocks.invoke).toHaveBeenCalledWith("set_ball_window_bounds", {
      x: 902,
      y: 0,
      width: 116,
      height: 42,
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "set_ball_window_region",
      expect.anything(),
    );
  });

  it("falls back to right-edge growth near the left screen edge", async () => {
    nativePosition = { x: 8, y: 0 };
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));

    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 8, y: 0, width: 296, height: 60 });
    });
    expect(getIsland()).toHaveClass("translation-island--right");
    expect(getSurface()).toHaveStyle({ transformOrigin: "0% 0%" });

    fireEvent.click(screen.getByRole("button", { name: "收起快速工具" }));
    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 8, y: 0, width: 116, height: 42 });
    });
  });

  it("falls back to left-edge growth near the right screen edge", async () => {
    nativePosition = { x: 1796, y: 0 };
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));

    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 1616, y: 0, width: 296, height: 60 });
    });
    expect(getIsland()).toHaveClass("translation-island--left");
    expect(getSurface()).toHaveStyle({ transformOrigin: "100% 0%" });

    fireEvent.click(screen.getByRole("button", { name: "收起快速工具" }));
    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 1796, y: 0, width: 116, height: 42 });
    });
  });

  it("keeps the island idle on hover and expands only after a click", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);

    fireEvent.pointerEnter(getIsland(), { pointerType: "mouse" });
    await advanceTimers(1000);
    fireEvent.pointerLeave(getIsland(), { pointerType: "mouse" });
    await advanceTimers(1000);

    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 296, height: 60 }));

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await advanceTimers(0);

    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 812, y: 0, width: 296, height: 60 });
    fireEvent.pointerLeave(getIsland(), { pointerType: "mouse" });
    await advanceTimers(1000);
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
  });

  it("keeps pointer capture on the pressed core so a real click reaches the button", async () => {
    render(<BallWindow />);
    const island = getIsland();
    const core = screen.getByRole("button", { name: "展开快速工具" });
    const captureCorePointer = vi.fn();
    const releaseCorePointer = vi.fn();
    const captureIslandPointer = vi.fn();
    let captureTarget: HTMLElement | null = null;

    Object.defineProperties(core, {
      setPointerCapture: {
        configurable: true,
        value: (pointerId: number) => {
          captureTarget = core;
          captureCorePointer(pointerId);
        },
      },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releaseCorePointer },
    });
    Object.defineProperty(island, "setPointerCapture", {
      configurable: true,
      value: (pointerId: number) => {
        captureTarget = island;
        captureIslandPointer(pointerId);
      },
    });

    fireEvent.pointerDown(core, {
      button: 0,
      pointerId: 7,
      clientX: 58,
      clientY: 21,
      pointerType: "mouse",
    });

    expect(captureCorePointer).toHaveBeenCalledWith(7);
    expect(captureIslandPointer).not.toHaveBeenCalled();

    const pointerTarget = captureTarget ?? core;
    fireEvent.pointerUp(pointerTarget, { button: 0, pointerId: 7, pointerType: "mouse" });
    fireEvent.click(pointerTarget);

    expect(releaseCorePointer).toHaveBeenCalledWith(7);
    expect(startDragging).not.toHaveBeenCalled();
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "actions"));
  });

  it.each(["pointerup", "blur"] as const)(
    "clears a pending island press on window %s",
    async (releaseEvent) => {
      render(<BallWindow />);

      fireEvent.pointerDown(getIsland(), {
        button: 0,
        clientX: 40,
        clientY: 20,
        pointerType: "mouse",
      });
      fireEvent.pointerLeave(getIsland(), { pointerType: "mouse" });
      if (releaseEvent === "pointerup") {
        fireEvent.pointerUp(window, { button: 0, pointerType: "mouse" });
      } else {
        fireEvent(window, new Event("blur"));
      }

      fireEvent.pointerMove(getIsland(), {
        clientX: 60,
        clientY: 20,
        pointerType: "mouse",
      });
      await act(async () => Promise.resolve());

      expect(startDragging).not.toHaveBeenCalled();
      expect(getSurface()).toHaveAttribute("data-mode", "idle");
    },
  );

  it("does not expand on focus alone", async () => {
    render(<BallWindow />);
    const core = screen.getByRole("button", { name: "展开快速工具" });

    fireEvent.focus(core);
    await act(async () => Promise.resolve());
    expect(getSurface()).toHaveAttribute("data-mode", "idle");

    fireEvent.click(core);
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "actions"));
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
  });

  it("does not expand while the idle core is being dragged", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    const core = screen.getByRole("button", { name: "展开快速工具" });

    fireEvent.pointerDown(core, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerMove(core, { clientX: 20, clientY: 10, pointerType: "mouse" });
    await advanceTimers(100);
    fireEvent.click(core);
    await advanceTimers(0);

    expect(startDragging).toHaveBeenCalledTimes(1);
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 296, height: 60 }));
  });

  it("queues business status until an idle native drag has finished", async () => {
    let finishDragging: (() => void) | undefined;
    startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDragging = resolve;
    }));
    render(<BallWindow />);
    const core = screen.getByRole("button", { name: "展开快速工具" });

    fireEvent.pointerDown(core, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerMove(core, { clientX: 20, clientY: 10, pointerType: "mouse" });
    await waitFor(() => expect(startDragging).toHaveBeenCalled());
    act(() => dispatchTranslationState({ state: "working" }));
    await act(async () => Promise.resolve());
    expect(getSurface()).toHaveAttribute("data-mode", "idle");

    await act(async () => finishDragging?.());
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "status"));
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 828, y: 0, width: 264, height: 52 });
  });

  it("drags actions from a command without collapsing or firing the command", async () => {
    let finishDragging: (() => void) | undefined;
    startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDragging = resolve;
    }));
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    const clipboardAction = await screen.findByRole("button", { name: "剪贴板" });
    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 812, y: 0, width: 296, height: 60 });
    });
    mocks.invoke.mockClear();

    fireEvent.pointerDown(clipboardAction, {
      button: 0,
      clientX: 40,
      clientY: 30,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(clipboardAction, {
      clientX: 50,
      clientY: 30,
      pointerType: "mouse",
    });
    await waitFor(() => expect(startDragging).toHaveBeenCalledTimes(1));

    fireEvent.blur(getIsland(), { relatedTarget: null });
    fireEvent.click(screen.getByRole("button", { name: "收起快速工具" }));
    fireEvent.click(clipboardAction);
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    expect(mocks.invoke).not.toHaveBeenCalledWith("translate_clipboard_from_ball");

    nativePosition = { x: 512, y: 64 };
    nativeSize = { width: 296, height: 60 };
    await act(async () => finishDragging?.());

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("save_ball_position", {
        x: 602,
        y: 64,
        reposition: false,
      });
    });
    expect(getSurface()).toHaveAttribute("data-mode", "actions");

    fireEvent.click(clipboardAction);
    expect(mocks.invoke).not.toHaveBeenCalledWith("translate_clipboard_from_ball");
  });

  it("drags a working status without interrupting the business state", async () => {
    let finishDragging: (() => void) | undefined;
    startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDragging = resolve;
    }));
    render(<BallWindow />);
    await waitFor(() => expect(listeners["translation-state"]).toBeDefined());

    act(() => dispatchTranslationState({ state: "working" }));
    expect(await screen.findByText("正在翻译")).toBeInTheDocument();
    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 828, y: 0, width: 264, height: 52 });
    });
    setBallWindowBounds.mockClear();
    mocks.invoke.mockClear();

    fireEvent.pointerDown(getIsland(), {
      button: 0,
      clientX: 60,
      clientY: 26,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(getIsland(), {
      clientX: 70,
      clientY: 26,
      pointerType: "mouse",
    });
    await waitFor(() => expect(startDragging).toHaveBeenCalledTimes(1));

    fireEvent.blur(getIsland(), { relatedTarget: null });
    expect(getSurface()).toHaveAttribute("data-mode", "status");
    expect(screen.getByText("正在翻译")).toBeInTheDocument();

    nativePosition = { x: 512, y: 64 };
    nativeSize = { width: 264, height: 52 };
    await act(async () => finishDragging?.());

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("save_ball_position", {
        x: 586,
        y: 64,
        reposition: false,
      });
    });
    expect(getSurface()).toHaveAttribute("data-mode", "status");
    expect(screen.getByText("正在翻译")).toBeInTheDocument();
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(
      expect.objectContaining({ width: 116, height: 42 }),
    );
  });

  it.each([
    { state: "done", collapseAfter: 1250 },
    { state: "error", collapseAfter: 1900 },
  ] as const)(
    "restarts the $state status collapse timer after a long drag",
    async ({ state, collapseAfter }) => {
      vi.useFakeTimers();
      let finishDragging: (() => void) | undefined;
      startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishDragging = resolve;
      }));
      render(<BallWindow />);
      await advanceTimers(0);

      fireEvent.pointerDown(getIsland(), {
        button: 0,
        clientX: 40,
        clientY: 20,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(getIsland(), {
        clientX: 50,
        clientY: 20,
        pointerType: "mouse",
      });
      await advanceTimers(0);
      expect(startDragging).toHaveBeenCalledTimes(1);

      act(() => dispatchTranslationState({ state }));
      await advanceTimers(0);
      expect(getSurface()).toHaveAttribute("data-mode", "idle");

      await advanceTimers(collapseAfter + 100);
      expect(getSurface()).toHaveAttribute("data-mode", "idle");

      nativePosition = { x: 602, y: 64 };
      nativeSize = { width: 116, height: 42 };
      await act(async () => finishDragging?.());
      await advanceTimers(0);
      expect(getSurface()).toHaveAttribute("data-mode", "status");

      await advanceTimers(collapseAfter - 1);
      expect(getSurface()).toHaveAttribute("data-mode", "status");
      await advanceTimers(1);
      expect(getSurface()).toHaveAttribute("data-mode", "idle");
    },
  );

  it("shows business status directly from the click-only idle state", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);

    act(() => dispatchTranslationState({ state: "working" }));
    await advanceTimers(0);

    expect(screen.getByText("正在翻译")).toBeInTheDocument();
    expect(getSurface()).toHaveAttribute("data-mode", "status");
    expect(setBallWindowBounds).toHaveBeenLastCalledWith({ x: 828, y: 0, width: 264, height: 52 });

    await advanceTimers(1000);
    expect(getSurface()).toHaveAttribute("data-mode", "status");
  });

  it("keeps clicked actions visible while clipboard translation activity is pending", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await advanceTimers(0);

    fireEvent.click(screen.getByRole("button", { name: "剪贴板" }));
    await advanceTimers(0);
    expect(mocks.invoke).toHaveBeenCalledWith("translate_clipboard_from_ball");

    fireEvent.pointerLeave(getIsland(), { pointerType: "mouse" });
    await advanceTimers(899);
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 116, height: 42 }));

    act(() => dispatchTranslationState({ state: "working" }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "status");
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 116, height: 42 }));

    await advanceTimers(400);
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 828, y: 0, width: 264, height: 52 });
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 116, height: 42 }));
  });

  it("keeps an error notice open when it replaces the focused action", async () => {
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "start_screenshot_from_ball") {
        return Promise.reject(new Error("网络不可用"));
      }
      return defaultInvoke(command, args);
    });
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    const screenshotAction = await screen.findByRole("button", { name: "截图" });
    fireEvent.focus(screenshotAction);
    fireEvent.click(screenshotAction);

    expect(await screen.findByText("操作失败")).toBeInTheDocument();
    fireEvent.blur(getIsland(), { relatedTarget: null });
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    expect(screen.getByText("网络不可用")).toBeInTheDocument();
  });

  it("keeps an explicit full expansion when translation starts in the same turn", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    await advanceTimers(0);

    act(() => {
      listeners["expand-main-window"]?.({ payload: undefined });
      dispatchTranslationState({ state: "working" });
    });
    await advanceTimers(400);

    expect(getSurface()).toHaveAttribute("data-mode", "full");
    expect(document.querySelector(".translation-island__full")).toHaveAttribute("aria-hidden", "false");
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 600, y: 0, width: 720, height: 380 });
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 264, height: 52 }));
  });

  it("reverses consecutive main-window toggles while a full transition is settling", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    await advanceTimers(0);

    act(() => listeners["expand-main-window"]?.({ payload: undefined }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "full");

    act(() => {
      listeners["toggle-main-window"]?.({ payload: undefined });
      listeners["toggle-main-window"]?.({ payload: undefined });
    });
    await advanceTimers(400);
    await advanceTimers(0);

    expect(getSurface()).toHaveAttribute("data-mode", "full");
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(
      expect.objectContaining({ width: 116, height: 42 }),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith("set_ball_window_material", expect.anything());
  });

  it("reverses consecutive main-window toggles while a native drag is pending", async () => {
    vi.useFakeTimers();
    let finishDragging: (() => void) | undefined;
    startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDragging = resolve;
    }));
    render(<BallWindow />);
    await advanceTimers(0);
    setBallWindowBounds.mockClear();

    fireEvent.pointerDown(getIsland(), {
      button: 0,
      clientX: 40,
      clientY: 20,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(getIsland(), {
      clientX: 50,
      clientY: 20,
      pointerType: "mouse",
    });
    await advanceTimers(0);
    expect(startDragging).toHaveBeenCalledTimes(1);

    act(() => {
      listeners["toggle-main-window"]?.({ payload: undefined });
      listeners["toggle-main-window"]?.({ payload: undefined });
    });
    expect(getSurface()).toHaveAttribute("data-mode", "idle");

    await act(async () => finishDragging?.());
    await advanceTimers(400);
    await advanceTimers(0);

    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(
      expect.objectContaining({ width: 720, height: 380 }),
    );
  });

  it("keeps the staged full collapse when the full workspace loses focus", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    await advanceTimers(0);
    expect(focusChangedListener).toBeDefined();

    act(() => listeners["expand-main-window"]?.({ payload: undefined }));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "full");

    act(() => focusChangedListener?.({ payload: false }));
    await advanceTimers(0);

    expect(getSurface()).toHaveAttribute("data-mode", "full");
    expect(getIsland()).toHaveClass("translation-island--full-exit");
    expect(getIsland()).not.toHaveClass("translation-island--instant");
    expect(document.querySelector(".translation-island__full")).toHaveAttribute("aria-hidden", "true");
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "set_ball_window_bounds",
      expect.objectContaining({ width: 116, height: 42 }),
    );

    await advanceTimers(120);
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "set_ball_window_bounds",
      expect.objectContaining({ width: 116, height: 42 }),
    );

    await advanceTimers(280);

    const idleBoundsCall = mocks.invoke.mock.calls.find(
      (call) => call[0] === "set_ball_window_bounds" &&
               call[1]?.width === 116 &&
               call[1]?.height === 42
    );
    expect(idleBoundsCall).toBeDefined();
    expect(idleBoundsCall?.[1]).not.toHaveProperty("durationMs");

    expect(mocks.invoke).not.toHaveBeenCalledWith("set_ball_window_material", expect.anything());
  });

  it("repairs native geometry when a collapse supersedes a pending expansion", async () => {
    vi.useFakeTimers();
    let finishFullBounds: (() => void) | undefined;
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "set_ball_window_bounds" && args?.width === 720) {
        setBallWindowBounds(args as NativeBounds);
        return new Promise<void>((resolve) => {
          finishFullBounds = resolve;
        });
      }
      return defaultInvoke(command, args);
    });
    render(<BallWindow />);
    await advanceTimers(0);
    expect(focusChangedListener).toBeDefined();

    act(() => listeners["expand-main-window"]?.({ payload: undefined }));
    await advanceTimers(0);
    expect(finishFullBounds).toBeDefined();
    expect(getSurface()).toHaveAttribute("data-mode", "idle");

    act(() => focusChangedListener?.({ payload: false }));
    await act(async () => finishFullBounds?.());
    await advanceTimers(280);

    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 902, y: 0, width: 116, height: 42 });
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
  });

  it("stages full content exit before the surface and native window collapse", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    await advanceTimers(0);
    act(() => listeners["expand-main-window"]?.({ payload: undefined }));
    await advanceTimers(280);
    setBallWindowBounds.mockClear();

    fireEvent.click(screen.getByTitle("收起为灵动岛"));
    await advanceTimers(0);
    expect(getSurface()).toHaveAttribute("data-mode", "full");
    expect(getIsland()).toHaveClass("translation-island--full-exit");
    expect(document.querySelector(".translation-island__full")).toHaveAttribute("aria-hidden", "true");

    await advanceTimers(119);
    expect(getSurface()).toHaveAttribute("data-mode", "full");
    await advanceTimers(1);
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(setBallWindowBounds).not.toHaveBeenCalled();

    await advanceTimers(279);
    expect(setBallWindowBounds).not.toHaveBeenCalled();
    await advanceTimers(1);
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 902, y: 0, width: 116, height: 42 });
  });

  it("shows translation progress and collapses after completion", async () => {
    render(<BallWindow />);
    await waitFor(() => expect(listeners["translation-state"]).toBeDefined());

    act(() => dispatchTranslationState({ state: "working" }));
    expect(await screen.findByText("正在翻译")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在翻译" })).toBeDisabled();
    expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 828, y: 0, width: 264, height: 52 });

    act(() => dispatchTranslationState({ state: "done" }));
    expect(await screen.findByText("翻译完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起翻译完成提示" })).toBeEnabled();

    await waitFor(
      () => expect(getSurface()).toHaveAttribute("data-mode", "idle"),
      { timeout: 2300 },
    );
    await waitFor(
      () => expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 902, y: 0, width: 116, height: 42 }),
      { timeout: 2300 },
    );
    expect(document.querySelector(".translation-island__surface")).toHaveAttribute("data-mode", "idle");
  });

  it("morphs directly from clipboard actions into translation status", async () => {
    render(<BallWindow />);
    await waitFor(() => expect(listeners["translation-state"]).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "剪贴板" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("translate_clipboard_from_ball"));

    act(() => dispatchTranslationState({ state: "working" }));
    expect(await screen.findByText("正在翻译")).toBeInTheDocument();
    await waitFor(
      () => expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 828, y: 0, width: 264, height: 52 }),
      { timeout: 800 },
    );
    expect(setBallWindowBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 116, height: 42 }));
  });

  it("expands into the full workspace and collapses back to the same island", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));

    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 600, y: 0, width: 720, height: 380 });
    });
    expect(setSize).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
    expect(getSurface()).toHaveAttribute("data-mode", "full");
    expect(document.querySelector(".translation-island__full")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByPlaceholderText("输入、粘贴或拖入文件")).toBeInTheDocument();
    const copySource = screen.getByText("复制原文").closest("button");
    const copyResult = screen.getByText("复制译文").closest("button");
    expect(copySource).toBeDisabled();
    expect(copyResult).toBeDisabled();
    expect(screen.getByText("智能选读").closest("button")).toBeEnabled();
    expect(screen.getByText("翻译记忆").closest("button")).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText("输入、粘贴或拖入文件"), {
      target: { value: "state stays here" },
    });
    fireEvent.click(copySource as HTMLButtonElement);
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("write_clipboard_safe", { text: "state stays here" });
    });
    fireEvent.click(screen.getByTitle("收起为灵动岛"));

    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 902, y: 0, width: 116, height: 42 });
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("set_ball_window_material", expect.anything());
    expect(setSize).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();

    act(() => listeners["expand-main-window"]?.({ payload: undefined }));
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "full"));
    expect(screen.getByDisplayValue("state stays here")).toBeInTheDocument();
  });

  it("snaps a dragged full workspace to the work-area top and persists its idle anchor", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 450)));

    setPosition.mockClear();
    mocks.invoke.mockClear();
    nativePosition = { x: 700, y: 20 };
    nativeSize = { width: 720, height: 380 };
    fireEvent.mouseDown(document.querySelector(".app-header") as HTMLElement, { button: 0 });

    await waitFor(() => expect(startDragging).toHaveBeenCalled());
    await waitFor(() => {
      expect(setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 600, y: 0 }));
    });
    expect(mocks.invoke).toHaveBeenCalledWith("save_ball_position", {
      x: 902,
      y: 0,
      reposition: false,
    });
  });

  it("keeps a full workspace where it was dropped outside the top snap threshold", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 450)));

    setPosition.mockClear();
    mocks.invoke.mockClear();
    nativePosition = { x: 700, y: 160 };
    nativeSize = { width: 720, height: 380 };
    fireEvent.mouseDown(document.querySelector(".app-header") as HTMLElement, { button: 0 });

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("save_ball_position", {
        x: 1002,
        y: 160,
        reposition: false,
      });
    });
    expect(setPosition).not.toHaveBeenCalled();
  });

  it("queues a full collapse until native dragging has finished", async () => {
    let finishDragging: (() => void) | undefined;
    startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDragging = resolve;
    }));
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 450)));

    fireEvent.mouseDown(document.querySelector(".app-header") as HTMLElement, { button: 0 });
    await waitFor(() => expect(startDragging).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle("收起为灵动岛"));
    await act(async () => Promise.resolve());
    expect(getSurface()).toHaveAttribute("data-mode", "full");

    await act(async () => finishDragging?.());
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "idle"));
    await waitFor(() => {
      expect(setBallWindowBounds).toHaveBeenCalledWith({ x: 902, y: 0, width: 116, height: 42 });
    });
  });

  it("only starts full dragging after the morph settles and from the primary button", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));
    await waitFor(() => expect(getSurface()).toHaveAttribute("data-mode", "full"));
    const header = document.querySelector(".app-header") as HTMLElement;

    fireEvent.mouseDown(header, { button: 0 });
    expect(startDragging).not.toHaveBeenCalled();

    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 450)));
    fireEvent.mouseDown(header, { button: 2 });
    expect(startDragging).not.toHaveBeenCalled();

    fireEvent.mouseDown(header, { button: 0 });
    await waitFor(() => expect(startDragging).toHaveBeenCalledTimes(1));
  });

  it("recomputes the snapped anchor for a scaled monitor with negative coordinates", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 450)));

    nativeScale = 1.5;
    nativeMonitor = {
      position: { x: -2560, y: -200 },
      size: { width: 2560, height: 1440 },
      workArea: {
        position: { x: -2560, y: -200 },
        size: { width: 2560, height: 1400 },
      },
      scaleFactor: 1.5,
    };
    nativePosition = { x: -1100, y: -260 };
    nativeSize = { width: 1080, height: 570 };
    setPosition.mockClear();
    mocks.invoke.mockClear();
    fireEvent.mouseDown(document.querySelector(".app-header") as HTMLElement, { button: 0 });

    await waitFor(() => {
      expect(setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: -1820, y: -200 }));
    });
    expect(mocks.invoke).toHaveBeenCalledWith("save_ball_position", {
      x: -1367,
      y: -200,
      reposition: false,
    });
  });
});
