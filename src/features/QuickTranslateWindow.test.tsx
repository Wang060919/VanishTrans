import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickTranslateWindow from "./QuickTranslateWindow";

type Listener = (event: { payload: unknown }) => void;
const listeners: Record<string, Listener> = {};
const setSize = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn((name: string, listener: Listener) => {
    listeners[name] = listener;
    return Promise.resolve(() => delete listeners[name]);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: "quick", setSize, startDragging })),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockedEmit = emit as unknown as ReturnType<typeof vi.fn>;

function dispatch(name: string, payload: unknown) {
  listeners[name]?.({ payload });
}

async function triggerAndFlush(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("QuickTranslateWindow", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedEmit.mockClear();
    setSize.mockClear();
    startDragging.mockClear();
    for (const name of Object.keys(listeners)) delete listeners[name];
    mockedInvoke.mockImplementation((command: string, args?: { text?: string; request?: { text?: string; requestId?: number } }) => {
      if (command === "cleanup_clipboard_text") return Promise.resolve(args?.text?.trim() ?? "");
      if (command === "translate_stream") {
        queueMicrotask(() => {
          dispatch("translate-stream-chunk", { requestId: args?.request?.requestId, chunk: "你好" });
          dispatch("translate-stream-done", { requestId: args?.request?.requestId, fullText: "你好世界" });
        });
        return Promise.resolve("你好世界");
      }
      return Promise.resolve(undefined);
    });
  });

  it("registers listeners before reporting that the compact window is ready", async () => {
    render(<QuickTranslateWindow />);

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("quick_frontend_ready"));
    expect(listeners["quick-translate"]).toBeDefined();
    expect(listeners["translate-stream-chunk"]).toBeDefined();
    expect(listeners["translate-stream-done"]).toBeDefined();
  });

  it("streams a selected-text translation and copies the result", async () => {
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate", " hello world "));

    await waitFor(() => expect(screen.getByText("hello world")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("你好世界")).toBeInTheDocument());
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", { state: "working" });
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", { state: "done" });
    expect(mockedInvoke).toHaveBeenCalledWith("translate_stream", expect.objectContaining({
      request: expect.objectContaining({
        text: "hello world",
        direction: "auto",
      }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("write_clipboard_safe", {
      text: "你好世界",
    }));
  });

  it("shows selection capture failures without starting translation", async () => {
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate-error"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate-error", "未读取到选中文字"));

    expect(await screen.findByText("未读取到选中文字")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("translate_stream", expect.anything());
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", { state: "error" });
  });

  it("reports a failed translation as an error rather than completion", async () => {
    mockedInvoke.mockImplementation((command: string, args?: { text?: string }) => {
      if (command === "cleanup_clipboard_text") return Promise.resolve(args?.text?.trim() ?? "");
      if (command === "translate_stream") return Promise.reject("网络连接失败");
      return Promise.resolve(undefined);
    });
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());

    await triggerAndFlush(() => dispatch("quick-translate", "hello"));

    expect(await screen.findByText("网络连接失败")).toBeInTheDocument();
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", { state: "working" });
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", { state: "error" });
    expect(mockedEmit).not.toHaveBeenCalledWith("translation-state", { state: "done" });
  });
});
