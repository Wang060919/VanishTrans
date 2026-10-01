import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BallWindow from "./BallWindow";

type Listener = (event: { payload: unknown }) => void;
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  invoke: vi.fn<(name: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  drag: vi.fn().mockResolvedValue(undefined),
  focus: vi.fn<(event: { payload: boolean }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async (name: string, payload: unknown) => {
    mocks.listeners.get(name)?.({ payload });
  }),
  listen: vi.fn((name: string, listener: Listener) => {
    mocks.listeners.set(name, listener);
    return Promise.resolve(() => mocks.listeners.delete(name));
  }),
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }), useThemeSync: vi.fn(),
}));
const monitor = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } }, scaleFactor: 1 };
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: () => Promise.resolve(monitor), monitorFromPoint: () => Promise.resolve(monitor),
  getCurrentWindow: () => ({
    label: "ball", scaleFactor: () => Promise.resolve(1),
    outerPosition: () => Promise.resolve({ x: 902, y: 0 }),
    outerSize: () => Promise.resolve({ width: 116, height: 42 }),
    innerSize: () => Promise.resolve({ width: 116, height: 42 }),
    setFocus: () => Promise.resolve(), startDragging: mocks.drag,
    onFocusChanged: (listener: typeof mocks.focus) => {
      mocks.focus = listener; return Promise.resolve(() => {});
    },
  }),
}));
const result = { source: "Stay focused.", text: "保持专注。", direction: "en2zh" };
const dispatch = (state: string, revision: number, requestId = 1) => act(() => {
  mocks.listeners.get("translation-state")?.({ payload: {
    state, sourceId: "quick:A", requestId, revision, ...(state === "done" ? { result } : {}),
  } });
});
const surface = () => document.querySelector(".translation-island__surface");
async function openResult() {
  render(<BallWindow />);
  await waitFor(() => expect(mocks.listeners.has("translation-state")).toBe(true));
  dispatch("done", 2);
  fireEvent.click(await screen.findByRole("button", { name: "查看翻译结果" }));
  await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "result"));
  expect(screen.getByText(result.text)).toBeInTheDocument();
}

describe("island result flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.invoke.mockImplementation(async (name, args) => {
      if (name === "get_api_config") return { baseUrl: "", model: "", hasApiKey: false };
      if (name === "get_pin_state") return false;
      if (name === "cleanup_clipboard_text") return args?.text;
      if (name === "translate_stream") return result.text;
      if (name === "save_ball_position") return [args?.x, args?.y];
      return undefined;
    });
  });
  it("opens, copies and restores the exact result in the full workspace without another request", async () => {
    await openResult();
    // The padded pre-morph canvas is followed by a post-settle retain clip at
    // the exact visual bounds.
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("set_ball_window_bounds",
      expect.objectContaining({ width: 392, height: 176, retainSurface: true })));
    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    expect(await screen.findByRole("button", { name: "译文已复制" })).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("write_clipboard_safe", { text: result.text });
    fireEvent.click(screen.getByRole("button", { name: "在主窗口中打开" }));
    await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "full"));
    expect(screen.getByPlaceholderText("输入、粘贴或拖入文件")).toHaveValue(result.source);
    expect(screen.getByText(result.text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "源语言：英语" })).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.some(([name]) => ["translate", "translate_stream", "translate_with_direction"].includes(name))).toBe(false);
  });
  it("lets a closed result be reopened from the tools and keeps reading separate from native dragging", async () => {
    await openResult();
    fireEvent.pointerDown(screen.getByText(result.text), { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(screen.getByText(result.text), { clientX: 100, clientY: 20 });
    expect(mocks.drag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭迷你翻译" }));
    await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "idle"));
    fireEvent.click(screen.getByRole("button", { name: "展开快速工具" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看译文" }));
    await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "result"));
    expect(screen.getByText(result.text)).toBeInTheDocument();
  });
  it("invalidates an open result when new work starts, ignoring the old completion", async () => {
    await openResult();
    dispatch("working", 3, 2);
    dispatch("done", 2);
    await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "status"));
    expect(await screen.findByText("正在翻译")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看翻译结果" })).not.toBeInTheDocument();
    expect(screen.queryByText(result.text)).not.toBeInTheDocument();
  });
  it("reports clipboard errors without hiding the translation", async () => {
    await openResult();
    mocks.invoke.mockImplementation(async (name) => {
      if (name === "write_clipboard_safe") throw new Error("剪贴板被占用");
    });
    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("剪贴板被占用");
    expect(screen.getByText(result.text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制译文" })).toBeEnabled();
  });
  it.each(["shortcut-translate", "clipboard-watch-translate"])(
    "keeps %s in compact status until the user requests the result", async (eventName) => {
      render(<BallWindow />);
      await waitFor(() => expect(mocks.listeners.has(eventName)).toBe(true));
      act(() => mocks.listeners.get(eventName)?.({ payload: result.source }));
      const open = await screen.findByRole("button", { name: "查看翻译结果" });
      expect(surface()).toHaveAttribute("data-mode", "status");
      expect(mocks.invoke.mock.calls.some(([name, args]) =>
        name === "set_ball_window_bounds" && args?.width === 720)).toBe(false);
      fireEvent.click(open);
      expect(await screen.findByText(result.text)).toBeInTheDocument();
    },
  );
  it("keeps an intentionally opened editor visible for new translations", async () => {
    render(<BallWindow />);
    await waitFor(() => expect(mocks.listeners.has("shortcut-translate")).toBe(true));
    act(() => mocks.listeners.get("expand-main-window")?.({ payload: undefined }));
    await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "full"));
    act(() => mocks.listeners.get("shortcut-translate")?.({ payload: result.source }));
    expect(await screen.findByText(result.text)).toBeInTheDocument();
    expect(surface()).toHaveAttribute("data-mode", "full");
  });
  it("opens the existing session error only when details are requested", async () => {
    render(<BallWindow />);
    await waitFor(() => expect(mocks.listeners.has("screenshot-error")).toBe(true));
    act(() => mocks.listeners.get("screenshot-error")?.({ payload: "未识别到文字，请重新截图" }));
    expect(await screen.findByText("翻译遇到问题")).toBeInTheDocument();
    expect(surface()).toHaveAttribute("data-mode", "status");
    fireEvent.click(screen.getAllByRole("button", { name: "查看翻译错误" })[0]);
    await waitFor(() => expect(surface()).toHaveAttribute("data-mode", "full"));
    expect(screen.getByText("未识别到文字，请重新截图")).toBeInTheDocument();
  });

});
