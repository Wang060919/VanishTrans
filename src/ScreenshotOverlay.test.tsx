import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import ScreenshotOverlay from "./ScreenshotOverlay";

const listeners: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, cb: (event: { payload: unknown }) => void) => {
    listeners[eventName] = cb;
    return Promise.resolve(() => {
      delete listeners[eventName];
    });
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ hide: vi.fn().mockResolvedValue(undefined) })),
}));

import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function emit(eventName: string, payload: unknown = undefined) {
  listeners[eventName]?.({ payload });
}

describe("ScreenshotOverlay", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  it("fetches the screenshot data URI once on mount without polling", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_data_uri") return Promise.resolve("data:image/png;base64,AAA");
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_screenshot_data_uri");
    });

    const img = container.querySelector("img") as HTMLImageElement;
    await waitFor(() => {
      expect(img.src).toContain("data:image/png;base64,AAA");
    });

    const callCountAfterMount = mockedInvoke.mock.calls.filter(
      (c) => c[0] === "get_screenshot_data_uri",
    ).length;
    expect(callCountAfterMount).toBe(1);
  });

  it("updates the image directly from the screenshot-ready event payload without re-polling", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_data_uri") return Promise.resolve("data:image/png;base64,AAA");
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);
    await waitFor(() => expect(listeners["screenshot-ready"]).toBeDefined());

    const callsBefore = mockedInvoke.mock.calls.filter(
      (c) => c[0] === "get_screenshot_data_uri",
    ).length;

    emit("screenshot-ready", "data:image/png;base64,BBB");

    const img = container.querySelector("img") as HTMLImageElement;
    await waitFor(() => {
      expect(img.src).toContain("data:image/png;base64,BBB");
    });

    const callsAfter = mockedInvoke.mock.calls.filter(
      (c) => c[0] === "get_screenshot_data_uri",
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });
});
