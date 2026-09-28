import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickTranslation } from "../useQuickTranslation";

type Listener = (event: { payload: unknown }) => void;
const listeners: Record<string, Listener> = {};
const bridge = vi.hoisted(() => ({
  reserveQuickRequest: vi.fn(), revealQuickResult: vi.fn(), quickFrontendReady: vi.fn(),
  cleanupClipboardText: vi.fn(), translateStream: vi.fn(),
}));
vi.mock("../../services/tauriBridge", () => bridge);
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn((name: string, listener: Listener) => {
    listeners[name] = listener;
    return Promise.resolve(() => delete listeners[name]);
  }),
}));

function dispatch(name: string, payload: unknown) { listeners[name]?.({ payload }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("quick fallback request ordering", () => {
  let sequence: number;
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of Object.keys(listeners)) delete listeners[name];
    sequence = 9;
    bridge.quickFrontendReady.mockResolvedValue(undefined);
    bridge.reserveQuickRequest.mockImplementation(async () => ++sequence);
    bridge.revealQuickResult.mockImplementation(async ({ requestSeq }: { requestSeq: number }) =>
      requestSeq === sequence);
    bridge.cleanupClipboardText.mockImplementation(async ({ text }: { text: string }) => text);
  });

  it.each(["return", "error"] as const)(
    "accepts newer Alt+R B over in-flight quick A, ignoring late chunks, done and IPC %s", async (settlement) => {
      const pending = deferred<string>();
      bridge.translateStream.mockReturnValue(pending.promise);
      const { result } = renderHook(useQuickTranslation);
      await waitFor(() => expect(listeners["quick-translate-result"]).toBeDefined());
      act(() => dispatch("quick-translate", "A source"));
      await waitFor(() => expect(bridge.translateStream).toHaveBeenCalledTimes(1));
      const requestId = bridge.translateStream.mock.calls[0][0].requestId as number;
      expect(sequence).toBe(10);
      act(() => dispatch("translate-stream-chunk", { requestId, chunk: "A partial" }));
      const b = ++sequence; // Native Alt+R claims 11 before translating.
      act(() => dispatch("quick-translate-result", {
        source: "B source", text: "B translated", requestSeq: b,
      }));
      expect(result.current.inputText).toBe("B source");
      expect(result.current.outputText).toBe("B translated");
      expect(result.current.loading).toBe(false);
      expect(result.current.translationError).toBeNull();
      const key = result.current.translationKey;

      act(() => {
        dispatch("translate-stream-chunk", { requestId, chunk: "A late chunk" });
        dispatch("translate-stream-done", { requestId, fullText: "A late done" });
      });
      await act(async () => {
        if (settlement === "return") pending.resolve("A late IPC");
        else pending.reject(new Error("A late error"));
      });
      expect(result.current.outputText).toBe("B translated");
      expect(result.current.inputText).toBe("B source");
      expect(result.current.translationKey).toBe(key);
      expect(result.current.translationError).toBeNull();
      expect(bridge.translateStream).toHaveBeenCalledTimes(1);
      expect(bridge.revealQuickResult).toHaveBeenCalledExactlyOnceWith({ requestSeq: b });
    },
  );

  it.each(["loading", "completed", "cancel", "reset"] as const)(
    "rejects older Alt+R A after newer quick B is %s", async (state) => {
      const old = ++sequence; // Native A = 10.
      const pending = deferred<string>();
      bridge.translateStream.mockReturnValue(pending.promise);
      const { result } = renderHook(useQuickTranslation);
      await waitFor(() => expect(listeners["quick-translate-result"]).toBeDefined());
      act(() => dispatch("quick-translate", "B source"));
      await waitFor(() => expect(bridge.translateStream).toHaveBeenCalledTimes(1));
      expect(sequence).toBe(11);
      if (state === "completed") {
        await act(async () => pending.resolve("B translated"));
      } else if (state === "cancel" || state === "reset") {
        act(() => result.current[state]());
        await waitFor(() => expect(sequence).toBe(12));
      }
      const before = {
        inputText: result.current.inputText, outputText: result.current.outputText,
        translationError: result.current.translationError, loading: result.current.loading,
        translationKey: result.current.translationKey,
      };
      act(() => dispatch("quick-translate-result", {
        source: "A source", text: "A stale", requestSeq: old,
      }));
      expect({
        inputText: result.current.inputText, outputText: result.current.outputText,
        translationError: result.current.translationError, loading: result.current.loading,
        translationKey: result.current.translationKey,
      }).toEqual(before);
      expect(bridge.revealQuickResult).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate, older and invalid sequences after accepting a fallback", async () => {
    const b = ++sequence;
    const { result } = renderHook(useQuickTranslation);
    await waitFor(() => expect(listeners["quick-translate-result"]).toBeDefined());
    const payload = { source: "B source", text: "B translated", requestSeq: b };
    act(() => dispatch("quick-translate-result", payload));
    const key = result.current.translationKey;
    act(() => {
      for (const requestSeq of [b, b - 1, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        dispatch("quick-translate-result", { ...payload, text: "stale", requestSeq });
      }
    });
    expect(result.current.outputText).toBe("B translated");
    expect(result.current.translationKey).toBe(key);
    expect(bridge.revealQuickResult).toHaveBeenCalledTimes(1);
    expect(bridge.translateStream).not.toHaveBeenCalled();
  });

  it("rejects a fallback while a user action has not finished reserving its sequence", async () => {
    const old = ++sequence;
    const pendingClaim = deferred<number>();
    bridge.reserveQuickRequest.mockReturnValue(pendingClaim.promise);
    const { result } = renderHook(useQuickTranslation);
    await waitFor(() => expect(listeners["quick-translate-result"]).toBeDefined());
    act(() => dispatch("quick-translate", "new source"));
    act(() => dispatch("quick-translate-result", {
      source: "old source", text: "old result", requestSeq: old,
    }));
    expect(result.current.outputText).toBe("");
    expect(bridge.revealQuickResult).not.toHaveBeenCalled();
    await act(async () => pendingClaim.resolve(++sequence));
  });
});
