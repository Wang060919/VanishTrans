import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileTranslation } from "../useFileTranslation";

const bridge = vi.hoisted(() => ({
  translateBatch: vi.fn(),
  translateWithDirection: vi.fn(),
}));

vi.mock("../../services/tauriBridge", () => bridge);

describe("useFileTranslation request identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.translateWithDirection.mockResolvedValue("fallback");
  });

  it("prevents an older file response from overwriting a newer invalid file", async () => {
    const pending = deferred<string[]>();
    bridge.translateBatch.mockReturnValue(pending.promise);
    const requestIdRef = { current: 0 };
    const directionRef = { current: "auto" as const };
    const setInputText = vi.fn<(text: string) => void>();
    const setOutputText = vi.fn<(text: string) => void>();
    const setLoading = vi.fn<(loading: boolean) => void>();
    const setStreaming = vi.fn<(streaming: boolean) => void>();
    const setGlowActive = vi.fn<(active: boolean) => void>();
    const setTranslationKey = vi.fn<(key: number) => void>();
    const doTranslateStream = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileTranslation({
      directionRef,
      requestIdRef,
      setInputText,
      setOutputText,
      setLoading,
      setStreaming,
      setGlowActive,
      setTranslationKey,
      doTranslateStream,
    }));

    let oldTask: Promise<void> | undefined;
    await act(async () => {
      oldTask = result.current.doTranslateFile(
        "old.srt",
        "1\n00:00:00,000 --> 00:00:01,000\nold text",
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(bridge.translateBatch).toHaveBeenCalledTimes(1));
    const oldRequestId = requestIdRef.current;

    await act(async () => {
      await result.current.doTranslateFile("new.xyz", "new content");
    });
    expect(requestIdRef.current).not.toBe(oldRequestId);
    expect(setOutputText).toHaveBeenCalledWith("❌ 不支持的文件类型: new.xyz");

    await act(async () => {
      pending.resolve(["stale translation"]);
      await oldTask;
    });
    expect(setOutputText).not.toHaveBeenCalledWith(expect.stringContaining("stale translation"));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
