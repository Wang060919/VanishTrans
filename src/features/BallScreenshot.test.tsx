import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BallWindow from "./BallWindow";

type Bounds = { x: number; y: number; width: number; height: number };
const native = vi.hoisted(() => ({
  bounds: { x: 902, y: 0, width: 116, height: 42 },
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  focus: undefined as ((event: { payload: boolean }) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => {
  const monitor = {
    position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1,
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  };
  return {
    currentMonitor: vi.fn().mockResolvedValue(monitor),
    monitorFromPoint: vi.fn().mockResolvedValue(monitor),
    getCurrentWindow: () => ({
      label: "ball",
      scaleFactor: async () => 1,
      outerPosition: async () => ({ x: native.bounds.x, y: native.bounds.y }),
      outerSize: async () => ({ width: native.bounds.width, height: native.bounds.height }),
      innerSize: async () => ({ width: native.bounds.width, height: native.bounds.height }),
      setFocus: vi.fn().mockResolvedValue(undefined),
      onFocusChanged: async (callback: typeof native.focus) => {
        native.focus = callback;
        return () => {};
      },
    }),
  };
});
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  useThemeSync: vi.fn(),
}));

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
}
const surface = () => document.querySelector(".translation-island__surface");

beforeEach(() => {
  vi.useFakeTimers();
  native.bounds = { x: 902, y: 0, width: 116, height: 42 };
  native.focus = undefined;
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "set_ball_window_bounds") {
      // Windows retains its viewport while clipping the collapsed island.
      if (args?.retainSurface) return true;
      native.bounds = args as Bounds;
    }
    if (command === "save_ball_position") return [args?.x, args?.y];
    if (command === "get_api_config") return { baseUrl: "https://api.openai.com", hasApiKey: false, model: "test" };
    if (command === "get_pin_state") return false;
    if (command === "start_screenshot_from_ball") {
      expect(surface()).toHaveAttribute("data-mode", "idle");
      expect(document.querySelector(".translation-island__content--actions")).toBeNull();
      native.focus?.({ payload: false });
    }
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("island screenshot entry points", () => {
  it.each(["actions", "full"] as const)("settles %s before hiding and can reopen after cancellation", async (entry) => {
    render(<BallWindow />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await settle();
    if (entry === "full") {
      fireEvent.click(screen.getByRole("button", { name: "主界面" }));
      await settle();
      expect(surface()).toHaveAttribute("data-mode", "full");
    }
    fireEvent.click(screen.getByRole("button", { name: entry === "full" ? "截图翻译" : "截图" }));
    await settle();
    expect(native.invoke).toHaveBeenCalledWith("start_screenshot_from_ball");
    expect(surface()).toHaveAttribute("data-mode", "idle");

    // Cancellation shows the same WebView without activation or remounting.
    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    await settle();
    expect(surface()).toHaveAttribute("data-mode", "actions");
    for (const name of ["截图", "剪贴板", "主界面"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(document.querySelectorAll(".translation-island__content--actions")).toHaveLength(1);
    const content = document.querySelector(".translation-island__content--actions");
    expect(parseFloat(getComputedStyle(content!).width)).toBeCloseTo(166, 0);
    // Capsule canvases stay padded past their 224px visual bounds for spring
    // overshoot and the press bulge; the full canvas keeps its exact size.
    expect(native.bounds.width).toBe(entry === "full" ? 560 : 254);
  });
});
