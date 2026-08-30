import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "../useConfig";

const bridge = vi.hoisted(() => ({
  applyServiceProfile: vi.fn(),
  deleteServiceProfile: vi.fn(),
  getApiConfig: vi.fn(),
  getLoggingEnabled: vi.fn(),
  saveServiceProfile: vi.fn(),
  setApiConfig: vi.fn(),
  setFreeTranslation: vi.fn(),
  setGlossary: vi.fn(),
  setHotkeys: vi.fn(),
  setLoggingEnabled: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("../../services/tauriBridge", () => bridge);

describe("useConfig persistence queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.getApiConfig.mockResolvedValue({
      baseUrl: "https://api.example.test",
      hasApiKey: false,
      model: "test-model",
      profiles: [],
      glossary: [],
      hotkeys: [],
      freeTranslation: false,
    });
    bridge.getLoggingEnabled.mockResolvedValue(true);
    bridge.setGlossary.mockResolvedValue(undefined);
    bridge.setHotkeys.mockResolvedValue(undefined);
    bridge.setApiConfig.mockResolvedValue(undefined);
    bridge.setFreeTranslation.mockResolvedValue(undefined);
    bridge.setLoggingEnabled.mockResolvedValue(undefined);
    bridge.saveServiceProfile.mockResolvedValue([]);
    bridge.deleteServiceProfile.mockResolvedValue([]);
    bridge.applyServiceProfile.mockResolvedValue({ name: "x", baseUrl: "https://x", model: "x" });
  });

  it("serializes overlapping glossary writes in call order", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    bridge.setGlossary.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useConfig());
    await act(async () => { await Promise.resolve(); });

    let firstWrite: Promise<void> | undefined;
    let secondWrite: Promise<void> | undefined;
    await act(async () => {
      firstWrite = result.current.saveGlossary([{ source: "one", target: "一" }]);
      secondWrite = result.current.saveGlossary([{ source: "two", target: "二" }]);
      await Promise.resolve();
    });
    expect(bridge.setGlossary).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await firstWrite;
      await Promise.resolve();
    });
    expect(bridge.setGlossary).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve();
      await secondWrite;
    });
    expect(bridge.setGlossary.mock.calls[1][0]).toEqual({
      glossary: [["two", "二"]],
    });
  });

  it("continues queued writes after a failed persistence call", async () => {
    bridge.setGlossary.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useConfig());
    await act(async () => { await Promise.resolve(); });

    let firstWrite: Promise<void> | undefined;
    let secondWrite: Promise<void> | undefined;
    act(() => {
      firstWrite = result.current.saveGlossary([{ source: "one", target: "一" }]);
      secondWrite = result.current.saveGlossary([{ source: "two", target: "二" }]);
    });
    await act(async () => {
      await expect(firstWrite).rejects.toThrow("disk full");
      await expect(secondWrite).resolves.toBeUndefined();
    });
    expect(bridge.setGlossary).toHaveBeenCalledTimes(2);
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
