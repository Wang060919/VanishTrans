import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTauriEvents } from "../useTauriEvents";

const mocks = vi.hoisted(() => ({
  frontendReady: vi.fn(),
  listen: vi.fn(),
  logFrontendMessage: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../services/tauriBridge", () => ({
  frontendReady: mocks.frontendReady,
  logFrontendMessage: mocks.logFrontendMessage,
}));

type Cleanup = () => void;

const options = {
  onClipboardTranslate: vi.fn(),
  onScreenshotStart: vi.fn(),
  onScreenshotError: vi.fn(),
  onShortcutConflicts: vi.fn(),
  onStreamChunk: vi.fn(),
  onStreamDone: vi.fn(),
};

describe("useTauriEvents lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.frontendReady.mockResolvedValue(undefined);
    mocks.logFrontendMessage.mockResolvedValue(undefined);
  });

  it("cleans up listeners already registered when a later listener fails", async () => {
    const released: string[] = [];
    mocks.listen.mockImplementation((name: string) => {
      if (name === "screenshot-start") return Promise.reject(new Error("registration failed"));
      const cleanup: Cleanup = () => released.push(name);
      return Promise.resolve(cleanup);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useTauriEvents(options));
    await waitFor(() => expect(mocks.logFrontendMessage).toHaveBeenCalled());

    expect(result.current).toBe(false);
    // Every attempt's partial registrations are released before the next try.
    expect(released).toEqual([
      "shortcut-translate", "clipboard-watch-translate",
      "shortcut-translate", "clipboard-watch-translate",
      "shortcut-translate", "clipboard-watch-translate",
    ]);
    expect(mocks.frontendReady).toHaveBeenCalledWith(false);
    expect(mocks.frontendReady).not.toHaveBeenCalledWith(true);
    consoleError.mockRestore();
  });

  it("retries listener registration and reports ready once a retry succeeds", async () => {
    const released: string[] = [];
    let attempts = 0;
    mocks.listen.mockImplementation((name: string) => {
      if (name === "screenshot-start" && attempts++ === 0) {
        return Promise.reject(new Error("transient registration failure"));
      }
      const cleanup: Cleanup = () => released.push(name);
      return Promise.resolve(cleanup);
    });

    const { result } = renderHook(() => useTauriEvents(options));
    await waitFor(() => expect(result.current).toBe(true));

    expect(released).toEqual(["shortcut-translate", "clipboard-watch-translate"]);
    expect(mocks.logFrontendMessage).not.toHaveBeenCalled();
  });

  it("exposes readiness only after registration and resets it on unmount", async () => {
    const released: string[] = [];
    mocks.listen.mockImplementation((name: string) => {
      const cleanup: Cleanup = () => released.push(name);
      return Promise.resolve(cleanup);
    });

    const { result, unmount } = renderHook(() => useTauriEvents(options));
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.frontendReady).not.toHaveBeenCalledWith(true);

    unmount();
    await waitFor(() => expect(mocks.frontendReady).toHaveBeenCalledTimes(2));
    expect(mocks.frontendReady).toHaveBeenLastCalledWith(false);
    expect(released).toHaveLength(7);
  });

  it("does not report not-ready on unmount when listeners never came up", async () => {
    mocks.listen.mockImplementation(() => Promise.reject(new Error("no tauri runtime")));

    const { unmount } = renderHook(() => useTauriEvents(options));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const callsBeforeUnmount = mocks.frontendReady.mock.calls.length;

    unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // Retries may add more frontend_ready(false) calls, but unmount itself
    // must not send one: this instance never reached readiness.
    expect(mocks.frontendReady.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
