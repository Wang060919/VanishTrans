import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "../useTranslation";

const bridge = vi.hoisted(() => ({
  translateBatch: vi.fn(), translateWithDirection: vi.fn(), translateStream: vi.fn(),
  cleanupClipboardText: vi.fn(), cancelTranslation: vi.fn(),
}));
vi.mock("../../services/tauriBridge", () => bridge);
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const srt = "1\n00:00:00,000 --> 00:00:01,000\nold text";

describe("translation operations share a window-local lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(bridge).forEach((mock) => mock.mockReset());
    bridge.cleanupClipboardText.mockImplementation(async ({ text }: { text: string }) => text);
    bridge.cancelTranslation.mockResolvedValue(undefined);
    bridge.translateWithDirection.mockResolvedValue("fallback");
    bridge.translateStream.mockResolvedValue("new translation");
  });

  it("prevents an older file response from overwriting a newer invalid file", async () => {
    const pending = deferred<string[]>();
    bridge.translateBatch.mockReturnValue(pending.promise);
    const { result } = renderHook(useTranslation);
    let oldTask!: Promise<void>;
    await act(async () => { oldTask = result.current.doTranslateFile("old.srt", srt); });
    await act(async () => { await result.current.doTranslateFile("new.xyz", "new content"); });
    expect(result.current.translationError).toBe("不支持的文件类型: new.xyz");
    await act(async () => { pending.resolve(["stale translation"]); await oldTask; });
    expect(result.current.outputText).toBe("");
    expect(result.current.translationError).toBe("不支持的文件类型: new.xyz");
  });

  it("clears an old error when a structured file succeeds", async () => {
    bridge.translateBatch.mockResolvedValue(["你好"]);
    const { result } = renderHook(useTranslation);
    act(() => result.current.resetTranslation("old error"));
    await act(async () => { await result.current.doTranslateFile("a.json", '{"text":"hello"}'); });
    expect(result.current.translationError).toBeNull();
    expect(JSON.parse(result.current.outputText)).toEqual({ text: "你好" });
    expect(result.current.loading).toBe(false);
  });

  it("cancels file status and never starts a fallback for a cancelled request", async () => {
    const pending = deferred<string[]>();
    bridge.translateBatch.mockReturnValue(pending.promise);
    const { result } = renderHook(useTranslation);
    let task!: Promise<void>;
    await act(async () => { task = result.current.doTranslateFile("a.srt", srt); });
    expect(result.current.fileStatus).toContain("翻译中");
    await act(async () => { await result.current.cancelTranslation(); });
    await act(async () => {
      pending.reject({ code: "SEGMENT_COUNT_MISMATCH", message: "mismatch" }); await task;
    });
    expect(result.current.fileStatus).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(bridge.translateWithDirection).not.toHaveBeenCalled();
  });

  it("lets a text request supersede a pending file request", async () => {
    const pending = deferred<string[]>();
    bridge.translateBatch.mockReturnValue(pending.promise);
    const { result } = renderHook(useTranslation);
    let task!: Promise<void>;
    await act(async () => { task = result.current.doTranslateFile("a.srt", srt); });
    await act(async () => { await result.current.doTranslateStream("new text"); });
    await act(async () => { pending.resolve(["old translation"]); await task; });
    expect(result.current.outputText).toBe("new translation");
    expect(result.current.fileStatus).toBeNull();
  });

  it("keeps partial output on cancellation and rejects all late stream events", async () => {
    const pending = deferred<string>();
    bridge.translateStream.mockReturnValue(pending.promise);
    const { result } = renderHook(useTranslation);
    let task!: Promise<void>;
    await act(async () => { task = result.current.doTranslateStream("hello"); });
    const { requestId } = bridge.translateStream.mock.calls[0][0] as { requestId: number };
    act(() => result.current.handleStreamChunk({ requestId, chunk: "partial" }));
    await act(async () => { await result.current.cancelTranslation(); });
    await act(async () => {
      result.current.handleStreamDone({ requestId, fullText: "late" });
      result.current.handleStreamChunk({ requestId, chunk: "late" });
      pending.resolve("late"); await task;
    });
    expect(result.current.outputText).toBe("partial");
    expect(result.current.streaming).toBe(false);
    expect(result.current.translationError).toContain("保留部分译文");
  });

  it.each(["event", "return"])("finalizes once when %s arrives first", async (first) => {
    const pending = deferred<string>();
    bridge.translateStream.mockReturnValue(pending.promise);
    const { result } = renderHook(useTranslation);
    let task!: Promise<void>;
    await act(async () => { task = result.current.doTranslateStream("hello"); });
    const { requestId } = bridge.translateStream.mock.calls[0][0] as { requestId: number };
    if (first === "event") act(() => result.current.handleStreamDone({ requestId, fullText: "complete" }));
    await act(async () => { pending.resolve("complete"); await task; });
    const key = result.current.translationKey;
    act(() => {
      result.current.handleStreamDone({ requestId, fullText: "complete" });
      result.current.handleStreamChunk({ requestId, chunk: "duplicate" });
    });
    expect(result.current.outputText).toBe("complete");
    expect(result.current.translationKey).toBe(key);
  });

  it("snapshots direction across a file fallback", async () => {
    const pending = deferred<string[]>();
    bridge.translateBatch.mockReturnValue(pending.promise);
    const { result } = renderHook(useTranslation);
    act(() => result.current.updateDirection("en2zh"));
    let task!: Promise<void>;
    await act(async () => { task = result.current.doTranslateFile("a.srt", srt); });
    act(() => result.current.updateDirection("zh2en"));
    await act(async () => {
      pending.reject({ code: "SEGMENT_COUNT_MISMATCH", message: "mismatch" }); await task;
    });
    expect(bridge.translateWithDirection).toHaveBeenCalledWith({ text: "old text", direction: "en2zh" });
  });

  it("does not dispatch a request when cancellation happens during input cleanup", async () => {
    const cleanup = deferred<string>();
    bridge.cleanupClipboardText.mockReturnValue(cleanup.promise);
    const { result } = renderHook(useTranslation);
    let task!: Promise<void>;
    await act(async () => { task = result.current.doTranslateStream("hello"); });
    await act(async () => { await result.current.cancelTranslation(); });
    await act(async () => { cleanup.resolve("hello"); await task; });
    expect(bridge.translateStream).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("rejects empty cleaned input before requesting translation", async () => {
    bridge.cleanupClipboardText.mockResolvedValue("");
    const { result } = renderHook(useTranslation);
    await act(async () => { await result.current.doTranslateStream("-\n"); });
    expect(bridge.translateStream).not.toHaveBeenCalled();
    expect(result.current.translationError).toBe("未读取到可翻译的文字");
  });

  it("keeps separately mounted window sessions independent", async () => {
    const pending = deferred<string>();
    bridge.translateStream.mockReturnValue(pending.promise);
    const first = renderHook(useTranslation);
    const second = renderHook(useTranslation);
    let task!: Promise<void>;
    await act(async () => { task = first.result.current.doTranslateStream("hello"); });
    await act(async () => { await second.result.current.cancelTranslation(); });
    await act(async () => { pending.resolve("first window result"); await task; });
    expect(first.result.current.outputText).toBe("first window result");
    expect(second.result.current.outputText).toBe("");
  });
});
