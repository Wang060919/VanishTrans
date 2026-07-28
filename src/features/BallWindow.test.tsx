import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BallWindow, { normalizeTranslationActivity } from "./BallWindow";

type Listener = (event: { payload: unknown }) => void;

const listeners: Record<string, Listener> = {};
let nativeSize = { width: 58, height: 38 };
let nativePosition = { x: 100, y: 100 };
const mocks = vi.hoisted(() => ({
  invoke: vi.fn((_command: string): Promise<unknown> => Promise.resolve()),
}));

const setSize = vi.fn(async (size: { width: number; height: number }) => {
  nativeSize = { width: size.width, height: size.height };
});
const setPosition = vi.fn(async (position: { x: number; y: number }) => {
  nativePosition = { x: position.x, y: position.y };
});
const setFocus = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());
const onFocusChanged = vi.fn(() => Promise.resolve(() => {}));

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
  currentMonitor: vi.fn(() => Promise.resolve({
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
  })),
  getCurrentWindow: vi.fn(() => ({
    label: "ball",
    scaleFactor: () => Promise.resolve(1),
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
    nativeSize = { width: 58, height: 38 };
    nativePosition = { x: 100, y: 100 };
    setSize.mockClear();
    setPosition.mockClear();
    setFocus.mockClear();
    startDragging.mockClear();
    onFocusChanged.mockClear();
    mocks.invoke.mockClear();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_api_config") {
        return Promise.resolve({
          baseUrl: "https://api.openai.com",
          hasApiKey: false,
          model: "gpt-4o-mini",
        });
      }
      if (command === "get_pin_state") return Promise.resolve(false);
      return Promise.resolve();
    });
    for (const name of Object.keys(listeners)) delete listeners[name];
  });

  it("expands the idle capsule into the integrated action island", async () => {
    render(<BallWindow />);

    expect(document.querySelector(".translation-island__surface")).toHaveAttribute("data-mode", "idle");
    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));

    expect(await screen.findByRole("button", { name: "剪贴板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "截图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主界面" })).toBeInTheDocument();
    expect(document.querySelector(".translation-island__surface")).toHaveAttribute("data-mode", "actions");
    expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 278, height: 58 }));
    expect(setFocus).toHaveBeenCalled();
  });

  it("shows translation progress and collapses after completion", async () => {
    render(<BallWindow />);
    await waitFor(() => expect(listeners["translation-state"]).toBeDefined());

    act(() => dispatchTranslationState({ state: "working" }));
    expect(await screen.findByText("正在翻译")).toBeInTheDocument();
    expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 232, height: 48 }));

    act(() => dispatchTranslationState({ state: "done" }));
    expect(await screen.findByText("翻译完成")).toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByText("翻译完成")).not.toBeInTheDocument(),
      { timeout: 1800 },
    );
    await waitFor(
      () => expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 58, height: 38 })),
      { timeout: 1800 },
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
      () => expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 232, height: 48 })),
      { timeout: 800 },
    );
    expect(setSize).not.toHaveBeenCalledWith(expect.objectContaining({ width: 58, height: 38 }));
  });

  it("expands into the full workspace and collapses back to the same island", async () => {
    render(<BallWindow />);

    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "主界面" }));

    await waitFor(() => {
      expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 420, height: 520 }));
    });
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("set_ball_window_material", { enabled: true });
    });
    expect(screen.getByPlaceholderText("输入、粘贴或拖入文件")).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("输入、粘贴或拖入文件"), {
      target: { value: "state stays here" },
    });
    fireEvent.click(screen.getByTitle("收起为灵动岛"));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("set_ball_window_material", { enabled: false });
      expect(setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 58, height: 38 }));
    });

    act(() => listeners["expand-main-window"]?.({ payload: undefined }));
    await waitFor(() => expect(screen.getByDisplayValue("state stays here")).toBeVisible());
  });
});
