import { ISLAND_TIMING } from "./islandModel";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BallWindow from "./BallWindow";

type Listener = (event: { payload: unknown }) => void;
type FocusChangedListener = (event: { payload: boolean }) => void;
type NativeBounds = { x: number; y: number; width: number; height: number };

const listeners: Record<string, Listener> = {};
let focusChangedListener: FocusChangedListener | undefined;
let nativeSize = { width: 116, height: 42 };
let nativePosition = { x: 902, y: 0 };
let nativeScale = 1;
// Faithful retained-surface model: retain_surface clips inside the canvas
// without moving/resizing it; the capsule shows at canvas.origin + offset.
let clip: { x: number; y: number; width: number; height: number } | null = null;
const nativeMonitor = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  scaleFactor: 1,
};
const mocks = vi.hoisted(() => ({
  invoke: vi.fn((_command: string, _args?: Record<string, unknown>): Promise<unknown> => Promise.resolve()),
}));

const setFocus = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());
const onFocusChanged = vi.fn((listener: FocusChangedListener) => {
  focusChangedListener = listener;
  return Promise.resolve(() => {});
});

function defaultInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  if (command === "start_window_drag") return startDragging().then(() => true);
  if (command === "set_ball_window_bounds") {
    const a = args as NativeBounds & { retainSurface?: boolean };
    if (a.retainSurface) {
      clip = {
        x: a.x - nativePosition.x,
        y: a.y - nativePosition.y,
        width: a.width,
        height: a.height,
      };
      return Promise.resolve(true);
    }
    clip = null;
    nativePosition = { x: a.x, y: a.y };
    nativeSize = { width: a.width, height: a.height };
    return Promise.resolve(false);
  }
  if (command === "save_ball_position") return Promise.resolve([args?.x, args?.y]);
  if (command === "get_api_config") {
    return Promise.resolve({ baseUrl: "https://api.openai.com", hasApiKey: false, model: "gpt-4o-mini" });
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
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
  PhysicalSize: class { constructor(public width: number, public height: number) {} },
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
    setSize: vi.fn(async (size: { width: number; height: number }) => {
      nativeSize = { width: size.width, height: size.height };
    }),
    setPosition: vi.fn(async (position: { x: number; y: number }) => {
      nativePosition = { x: position.x, y: position.y };
    }),
    setFocus,
    startDragging,
    onFocusChanged,
    isFocused: () => Promise.resolve(false),
  })),
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: vi.fn(() => ({ theme: "dark", setTheme: vi.fn() })),
  useThemeSync: vi.fn(),
}));

function dispatchTranslationState(payload: unknown) {
  listeners["translation-state"]?.({ payload });
}
function getSurface() {
  return document.querySelector(".translation-island__surface");
}
async function advanceTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("island reopen after retained collapse", () => {
  beforeEach(() => {
    focusChangedListener = undefined;
    nativeSize = { width: 116, height: 42 };
    nativePosition = { x: 902, y: 0 };
    nativeScale = 1;
    clip = null;
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

  it("reopens actions after full -> clear broadcast -> blur collapse", async () => {
    vi.useFakeTimers();
    render(<BallWindow />);
    await advanceTimers(0);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await advanceTimers(ISLAND_TIMING.surfaceMs + 100);
    fireEvent.click(screen.getByRole("button", { name: "主界面" }));
    await advanceTimers(ISLAND_TIMING.surfaceMs + 100);
    expect(getSurface()).toHaveAttribute("data-mode", "full");

    // Main window "清空" broadcast + focus loss -> collapse keeps the full canvas.
    act(() => dispatchTranslationState({
      state: "idle", sourceId: "main:X", requestId: 1, revision: 1,
    }));
    act(() => focusChangedListener?.({ payload: false }));
    // Focus-loss collapse is debounced (~280ms) before the staged exit runs.
    await advanceTimers(ISLAND_TIMING.fullContentExitMs + ISLAND_TIMING.collapseMs + 520);
    await act(async () => Promise.resolve());
    expect(getSurface()).toHaveAttribute("data-mode", "idle");
    expect(clip).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await advanceTimers(ISLAND_TIMING.surfaceMs + 200);
    await act(async () => Promise.resolve());
    expect(getSurface()).toHaveAttribute("data-mode", "actions");
    expect(screen.queryByRole("button", { name: "剪贴板" })).toBeInTheDocument();
    expect(clip).toMatchObject({ width: 224, height: 48 });
  });

  it("still completes transitions when the webview stops running animations", async () => {
    vi.useFakeTimers();
    // A suspended renderer leaves animation.finished pending forever; the
    // settle wait must still let the native bounds step run.
    const never = () => [{ finished: new Promise(() => {}) }] as unknown as Animation[];
    const original = Element.prototype.getAnimations;
    Element.prototype.getAnimations = never;
    try {
      render(<BallWindow />);
      await advanceTimers(0);

      fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
      await advanceTimers(ISLAND_TIMING.surfaceMs + 400);
      await act(async () => Promise.resolve());
      expect(getSurface()).toHaveAttribute("data-mode", "actions");
      expect(screen.queryByRole("button", { name: "剪贴板" })).toBeInTheDocument();

      // Collapse back to idle and reopen again — the queue must not wedge.
      act(() => focusChangedListener?.({ payload: false }));
      await advanceTimers(ISLAND_TIMING.collapseMs + 700);
      await act(async () => Promise.resolve());
      expect(getSurface()).toHaveAttribute("data-mode", "idle");

      fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
      await advanceTimers(ISLAND_TIMING.surfaceMs + 400);
      await act(async () => Promise.resolve());
      expect(getSurface()).toHaveAttribute("data-mode", "actions");
      expect(screen.queryByRole("button", { name: "主界面" })).toBeInTheDocument();
    } finally {
      Element.prototype.getAnimations = original;
    }
  });
});
