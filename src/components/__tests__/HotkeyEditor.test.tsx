import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HotkeyEditor from "../HotkeyEditor";

const bridge = vi.hoisted(() => ({
  setShortcutsSuspended: vi.fn(),
}));

vi.mock("../../services/tauriBridge", () => bridge);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function suspendedCalls(flag: boolean) {
  return bridge.setShortcutsSuspended.mock.calls.filter(
    ([args]) => (args as { suspended: boolean }).suspended === flag
  );
}

describe("HotkeyEditor suspend accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.setShortcutsSuspended.mockResolvedValue(undefined);
  });

  it("suspends global hotkeys only once when 修改 is clicked twice quickly", async () => {
    const suspend = deferred<void>();
    bridge.setShortcutsSuspended.mockReturnValue(suspend.promise);
    render(<HotkeyEditor label="划词翻译" value="Alt+Q" onChange={vi.fn()} />);

    const recordButton = screen.getByRole("button", { name: "修改" });
    fireEvent.click(recordButton);
    fireEvent.click(recordButton);
    await act(async () => { await Promise.resolve(); });
    expect(suspendedCalls(true)).toHaveLength(1);

    await act(async () => { suspend.resolve(); });
    expect(await screen.findByRole("button", { name: "取消" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(suspendedCalls(false)).toHaveLength(1));
    expect(bridge.setShortcutsSuspended).toHaveBeenCalledTimes(2);
  });

  it("resumes a suspend that resolves after the editor unmounts", async () => {
    const suspend = deferred<void>();
    bridge.setShortcutsSuspended.mockReturnValue(suspend.promise);
    const { unmount } = render(
      <HotkeyEditor label="划词翻译" value="Alt+Q" onChange={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "修改" }));
    await act(async () => { await Promise.resolve(); });
    expect(suspendedCalls(true)).toHaveLength(1);

    // Unmount while the suspend call is still in flight: the resume must be
    // chained onto the pending promise, not skipped because the flag is unset.
    unmount();
    await act(async () => { suspend.resolve(); });
    await waitFor(() => expect(suspendedCalls(false)).toHaveLength(1));
  });

  it("does not send a resume when the suspend call itself failed", async () => {
    bridge.setShortcutsSuspended.mockRejectedValueOnce(new Error("ipc down"));
    render(<HotkeyEditor label="划词翻译" value="Alt+Q" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "修改" }));
    expect(await screen.findByRole("button", { name: "取消" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { await Promise.resolve(); });
    expect(suspendedCalls(false)).toHaveLength(0);
  });
});
