import { afterEach, describe, expect, it, vi } from "vitest";
import { settleBallSurface } from "./ballSurfaceSettlement";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function surfaceWithAnimation(finished: Promise<Animation>) {
  const surface = document.createElement("div");
  surface.className = "translation-island__surface";
  surface.getAnimations = () => [{ finished } as Animation];
  document.body.append(surface);
}

describe("native collapse paint barrier", () => {
  it("does not release native resizing when the nominal duration passes before CSS finishes", async () => {
    vi.useFakeTimers();
    let finish!: (value: Animation) => void;
    surfaceWithAnimation(new Promise((resolve) => { finish = resolve; }));
    const settled = vi.fn();
    const pending = settleBallSurface(360, new AbortController().signal).then(settled);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).not.toHaveBeenCalled();
    finish({} as Animation);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(64);
    await pending;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("abandons the pending native resize if another transition supersedes it", async () => {
    surfaceWithAnimation(new Promise(() => {}));
    const controller = new AbortController();
    const pending = settleBallSurface(360, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("superseded");
  });
});
