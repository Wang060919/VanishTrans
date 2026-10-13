import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickTranslateWindow from "./QuickTranslateWindow";
import { useQuickTranslation } from "../hooks/useQuickTranslation";

type Listener = (event: { payload: unknown }) => void;
const listeners: Record<string, Listener> = {};
const setSize = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());
let quickSequence = 0;
function startAltR() { return ++quickSequence; }

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
import { emit, listen } from "@tauri-apps/api/event";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockedEmit = emit as unknown as ReturnType<typeof vi.fn>;
const mockedListen = listen as unknown as ReturnType<typeof vi.fn>;

function dispatch(name: string, payload: unknown) {
  listeners[name]?.({ payload });
}

async function triggerAndFlush(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("QuickTranslateWindow", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedEmit.mockClear();
    setSize.mockClear();
    startDragging.mockClear();
    quickSequence = 0;
    for (const name of Object.keys(listeners)) delete listeners[name];
    mockedInvoke.mockImplementation((command: string, args?: { text?: string; requestSeq?: number; request?: { text?: string; requestId?: number } }) => {
      if (command === "reserve_quick_request") return Promise.resolve(++quickSequence);
      if (command === "reveal_quick_result") return Promise.resolve(args?.requestSeq === quickSequence);
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

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("quick_frontend_ready", { ready: true }));
    expect(listeners["quick-translate"]).toBeDefined();
    expect(listeners["translate-stream-chunk"]).toBeDefined();
    expect(listeners["translate-stream-done"]).toBeDefined();
  });

  it("retries listener registration when the first attempt fails", async () => {
    const baseImpl = mockedListen.getMockImplementation();
    let rejectedOnce = false;
    mockedListen.mockImplementation((name: string, listener: Listener) => {
      if (name === "quick-translate" && !rejectedOnce) {
        rejectedOnce = true;
        return Promise.reject(new Error("ipc gone"));
      }
      listeners[name] = listener;
      return Promise.resolve(() => delete listeners[name]);
    });

    render(<QuickTranslateWindow />);

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("quick_frontend_ready", { ready: true }));
    expect(listeners["quick-translate"]).toBeDefined();
    expect(listeners["translate-stream-done"]).toBeDefined();
    if (baseImpl) mockedListen.mockImplementation(baseImpl);
  });

  it("keeps the native quick-window body style for the lifetime of the view", () => {
    const { unmount } = render(<QuickTranslateWindow />);
    expect(document.body).toHaveClass("quick-window-body");
    unmount();
    expect(document.body).not.toHaveClass("quick-window-body");
  });

  it("streams a selected-text translation and copies the result", async () => {
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate", " hello world "));

    await waitFor(() => expect(screen.getByText("hello world")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("你好世界")).toBeInTheDocument());
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", expect.objectContaining({ state: "working" }));
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", expect.objectContaining({ state: "done" }));
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

  it("surfaces a copy failure instead of showing 已复制", async () => {
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate", "hello"));
    await waitFor(() => expect(screen.getByText("你好世界")).toBeInTheDocument());

    mockedInvoke.mockImplementation((command: string, args?: { text?: string }) => {
      if (command === "write_clipboard_safe") {
        return Promise.reject({ code: "CLIPBOARD", message: "剪贴板占用" });
      }
      if (command === "cleanup_clipboard_text") return Promise.resolve(args?.text?.trim() ?? "");
      return Promise.resolve(undefined);
    });

    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("剪贴板占用");
  });

  it("applies the window size once and does not repeat identical setSize calls", async () => {
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(setSize).toHaveBeenCalled());
    const callsAfterMount = setSize.mock.calls.length;

    await triggerAndFlush(() => dispatch("quick-translate", "hello"));
    await waitFor(() => expect(screen.getByText("你好世界")).toBeInTheDocument());

    // jsdom reports no measurable layout, so the clamped height never changes:
    // streaming chunks must not translate into repeated native setSize calls.
    expect(setSize.mock.calls.length).toBe(callsAfterMount);
  });

  it("shows selection capture failures without starting translation", async () => {
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate-error"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate-error", "未读取到选中文字"));

    expect(await screen.findByText("未读取到选中文字")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("translate_stream", expect.anything());
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", expect.objectContaining({ state: "error" }));
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
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", expect.objectContaining({ state: "working" }));
    expect(mockedEmit).toHaveBeenCalledWith("translation-state", expect.objectContaining({ state: "error" }));
    expect(mockedEmit).not.toHaveBeenCalledWith("translation-state", expect.objectContaining({ state: "done" }));
  });

  it("A fallback delivers the existing translation once without an API call", async () => {
    const a = startAltR(); // Claimed by Rust at shortcut start, before any asynchronous work.
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate-result"]).toBeDefined());

    await triggerAndFlush(() => {
      dispatch("quick-translate-result", { source: "A source", text: "A translated", requestSeq: a });
      dispatch("quick-translate-result", { source: "A source", text: "A translated", requestSeq: a });
    });

    expect(screen.getByText("A source")).toBeInTheDocument();
    expect(screen.getByText("A translated")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("translate_stream", expect.anything());
    expect(mockedInvoke.mock.calls.filter(([name]) => name === "reveal_quick_result")).toHaveLength(1);
    expect(mockedEmit.mock.calls.filter(([name, value]) =>
      name === "translation-state" && value.state === "done")).toHaveLength(1);
  });

  it("A starts, B starts and completes, A falls back: B stays and no stale focus", async () => {
    const a = startAltR();
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate", "B source"));
    await waitFor(() => expect(screen.getByText("你好世界")).toBeInTheDocument());

    const before = mockedEmit.mock.calls.filter(([name, value]) =>
      name === "translation-state" && value.state === "done").length;
    await triggerAndFlush(() => dispatch("quick-translate-result", {
      source: "A source", text: "A translated", requestSeq: a,
    }));

    expect(screen.getByText("B source")).toBeInTheDocument();
    expect(screen.getByText("你好世界")).toBeInTheDocument();
    expect(screen.queryByText("A translated")).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalledWith("reveal_quick_result", expect.anything());
    expect(mockedEmit.mock.calls.filter(([name, value]) =>
      name === "translation-state" && value.state === "done")).toHaveLength(before);
  });

  it("A starts, B fails, A falls back: the failure is retained", async () => {
    const a = startAltR();
    mockedInvoke.mockImplementation((command: string, args?: { text?: string; requestSeq?: number }) => {
      if (command === "reserve_quick_request") return Promise.resolve(++quickSequence);
      if (command === "reveal_quick_result") return Promise.resolve(args?.requestSeq === quickSequence);
      if (command === "cleanup_clipboard_text") return Promise.resolve(args?.text?.trim() ?? "");
      if (command === "translate_stream") return Promise.reject("B failed");
      return Promise.resolve(undefined);
    });
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate", "B source"));
    expect(await screen.findByText("B failed")).toBeInTheDocument();

    await triggerAndFlush(() => dispatch("quick-translate-result", {
      source: "A source", text: "A translated", requestSeq: a,
    }));
    expect(screen.getByText("B failed")).toBeInTheDocument();
    expect(screen.queryByText("A translated")).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalledWith("reveal_quick_result", expect.anything());
  });

  it.each(["cancel", "reset"] as const)(
    "A starts, B starts then %s, A falls back: never restores A", async (action) => {
      const a = startAltR();
      mockedInvoke.mockImplementation((command: string, args?: { text?: string; requestSeq?: number }) => {
        if (command === "reserve_quick_request") return Promise.resolve(++quickSequence);
        if (command === "reveal_quick_result") return Promise.resolve(args?.requestSeq === quickSequence);
        if (command === "cleanup_clipboard_text") return Promise.resolve(args?.text?.trim() ?? "");
        if (command === "translate_stream") return new Promise(() => undefined);
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(useQuickTranslation);
      await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
      await triggerAndFlush(() => dispatch("quick-translate", "B source"));
      await act(async () => { result.current[action](); await Promise.resolve(); });
      await triggerAndFlush(() => dispatch("quick-translate-result", {
        source: "A source", text: "A translated", requestSeq: a,
      }));
      expect(result.current.outputText).toBe("");
      expect(mockedInvoke).not.toHaveBeenCalledWith("reveal_quick_result", expect.anything());
    },
  );

  it("rejects a fallback immediately while B's backend sequence claim is pending", async () => {
    const a = startAltR();
    let resolveClaim!: (value: number) => void;
    mockedInvoke.mockImplementation((command: string, args?: { text?: string }) => {
      if (command === "reserve_quick_request") return new Promise<number>((resolve) => {
        resolveClaim = resolve;
      });
      if (command === "cleanup_clipboard_text") return Promise.resolve(args?.text?.trim() ?? "");
      return Promise.resolve(undefined);
    });
    render(<QuickTranslateWindow />);
    await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
    await triggerAndFlush(() => dispatch("quick-translate", "B source"));
    await triggerAndFlush(() => dispatch("quick-translate-result", {
      source: "A source", text: "A translated", requestSeq: a,
    }));
    expect(screen.queryByText("A translated")).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalledWith("reveal_quick_result", expect.anything());
    await act(async () => { resolveClaim(++quickSequence); });
  });

  describe.each([
    { label: "Escape", close: () => fireEvent.keyDown(document, { key: "Escape" }) },
    { label: "close button", close: () => fireEvent.click(screen.getByRole("button", { name: "关闭迷你翻译" })) },
  ])("$label cancellation", ({ close }) => {
    it.each(["resolves", "rejects"] as const)("ignores late streaming events and IPC that %s, then accepts a new request", async (settlement) => {
      const stream = deferred<string>();
      const cancellation = deferred<void>();
      const closeClaim = deferred<number>();
      const baseInvoke = mockedInvoke.getMockImplementation() as (command: string, args?: unknown) => Promise<unknown>;
      let holdCloseClaim = false;
      let closeSequence = 0;
      mockedInvoke.mockImplementation((command: string, args?: { request?: { text?: string } }) => {
        if (command === "translate_stream" && args?.request?.text === "B source") return stream.promise;
        if (command === "cancel_translation") return cancellation.promise;
        if (command === "reserve_quick_request" && holdCloseClaim) {
          holdCloseClaim = false;
          closeSequence = ++quickSequence;
          return closeClaim.promise;
        }
        return baseInvoke(command, args);
      });
      render(<QuickTranslateWindow />);
      await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
      await triggerAndFlush(() => dispatch("quick-translate", "B source"));
      const requestId = mockedInvoke.mock.calls.find(([name]) => name === "translate_stream")?.[1].request.requestId;
      expect(requestId).toBeTypeOf("number");
      await triggerAndFlush(() => dispatch("translate-stream-chunk", { requestId, chunk: "partial" }));
      expect(screen.getByText("partial")).toBeInTheDocument();
      expect(screen.getByText("翻译中")).toBeInTheDocument();
      // This native fallback is already queued before the user closes the view.
      const queuedSequence = ++quickSequence;
      holdCloseClaim = true;

      await triggerAndFlush(close);

      expect(mockedInvoke).toHaveBeenCalledWith("cancel_translation");
      expect(mockedInvoke).toHaveBeenCalledWith("hide_quick_window");
      expect(screen.queryByText("翻译中")).toBeNull();
      expect(screen.getByText("翻译已取消，已保留部分译文")).toBeInTheDocument();
      expect(mockedEmit).toHaveBeenLastCalledWith("translation-state", expect.objectContaining({ state: "idle" }));
      await triggerAndFlush(() => {
        dispatch("translate-stream-chunk", { requestId, chunk: " late chunk" });
        dispatch("translate-stream-done", { requestId, fullText: "late completion" });
        dispatch("quick-translate-result", { source: "queued source", text: "queued fallback", requestSeq: queuedSequence });
        if (settlement === "resolves") stream.resolve("late IPC result");
        else stream.reject("late IPC error");
      });
      expect(mockedInvoke).not.toHaveBeenCalledWith("reveal_quick_result", expect.anything());
      await act(async () => { closeClaim.resolve(closeSequence); });
      expect(mockedInvoke).not.toHaveBeenCalledWith("reveal_quick_result", expect.anything());
      expect(screen.queryByText(/late|queued/)).toBeNull();
      expect(screen.getByText("翻译已取消，已保留部分译文")).toBeInTheDocument();
      expect(mockedEmit).toHaveBeenLastCalledWith("translation-state", expect.objectContaining({ state: "idle" }));
      fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
      await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("write_clipboard_safe", { text: "partial" }));
      await act(async () => { cancellation.resolve(); });

      await triggerAndFlush(() => dispatch("quick-translate", "C source"));
      expect(await screen.findByText("你好世界")).toBeInTheDocument();
      expect(screen.getByText("C source")).toBeInTheDocument();
      expect(mockedEmit).toHaveBeenLastCalledWith("translation-state", expect.objectContaining({ state: "done" }));
    });

    it.each(["sequence claim", "clipboard cleanup"] as const)("stops translation before dispatch while waiting for %s", async (stage) => {
      const preparation = deferred<number | string>();
      const baseInvoke = mockedInvoke.getMockImplementation() as (command: string, args?: unknown) => Promise<unknown>;
      const commandToDelay = stage === "sequence claim" ? "reserve_quick_request" : "cleanup_clipboard_text";
      let pendingSequence = 0;
      let delayed = false;
      mockedInvoke.mockImplementation((command: string, args?: unknown) => {
        if (command === commandToDelay && !delayed) {
          delayed = true;
          if (stage === "sequence claim") pendingSequence = ++quickSequence;
          return preparation.promise;
        }
        return baseInvoke(command, args);
      });
      render(<QuickTranslateWindow />);
      await waitFor(() => expect(listeners["quick-translate"]).toBeDefined());
      await triggerAndFlush(() => dispatch("quick-translate", "B source"));
      expect(delayed).toBe(true);
      expect(screen.getByText("翻译中")).toBeInTheDocument();

      await triggerAndFlush(close);
      await act(async () => { preparation.resolve(stage === "sequence claim" ? pendingSequence : "B source"); });

      expect(mockedInvoke).toHaveBeenCalledWith("cancel_translation");
      expect(mockedInvoke).toHaveBeenCalledWith("hide_quick_window");
      expect(mockedInvoke).not.toHaveBeenCalledWith("translate_stream", expect.anything());
      expect(screen.queryByText("翻译中")).toBeNull();
      expect(screen.getByText("翻译已取消")).toBeInTheDocument();
      expect(mockedEmit).toHaveBeenLastCalledWith("translation-state", expect.objectContaining({ state: "idle" }));
    });
  });
});
