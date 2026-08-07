import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
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
let canvasContext: Record<string, any>;

const screenshotPayload = {
  dataUri: "data:image/png;base64,AAA",
  imageWidth: 3840,
  imageHeight: 2160,
  monitorX: -1920,
  monitorY: 0,
  monitorWidth: 3840,
  monitorHeight: 2160,
  scaleFactor: 1.5,
  smartRegions: [],
};

function emit(eventName: string, payload: unknown = undefined) {
  listeners[eventName]?.({ payload });
}

describe("ScreenshotOverlay", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
    canvasContext = {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })),
      fillText: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
    };
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => canvasContext),
    });
  });

  it("fetches the screenshot payload once on mount without polling", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_payload") return Promise.resolve(screenshotPayload);
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_screenshot_payload");
    });

    const img = container.querySelector("img") as HTMLImageElement;
    await waitFor(() => {
      expect(img.src).toContain("data:image/png;base64,AAA");
    });

    const callCountAfterMount = mockedInvoke.mock.calls.filter(
      (c) => c[0] === "get_screenshot_payload",
    ).length;
    expect(callCountAfterMount).toBe(1);
  });

  it("updates the image directly from the screenshot-ready event payload without re-polling", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_payload") return Promise.resolve(screenshotPayload);
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);
    await waitFor(() => expect(listeners["screenshot-ready"]).toBeDefined());

    const callsBefore = mockedInvoke.mock.calls.filter(
      (c) => c[0] === "get_screenshot_payload",
    ).length;

    emit("screenshot-ready", {
      ...screenshotPayload,
      dataUri: "data:image/png;base64,BBB",
    });

    const img = container.querySelector("img") as HTMLImageElement;
    await waitFor(() => {
      expect(img.src).toContain("data:image/png;base64,BBB");
    });

    const callsAfter = mockedInvoke.mock.calls.filter(
      (c) => c[0] === "get_screenshot_payload",
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("shows an error when the replacement screenshot cannot be loaded", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_payload") return Promise.resolve(screenshotPayload);
      return Promise.resolve(undefined);
    });
    const { container, getByText } = render(<ScreenshotOverlay />);
    const img = container.querySelector("img") as HTMLImageElement;

    await waitFor(() => expect(img.src).toContain("data:image/png;base64,AAA"));
    fireEvent.error(img);

    expect(getByText("截图加载失败，点击重试")).toBeInTheDocument();
  });

  it("maps a high-DPI selection to full-resolution crop coordinates", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_payload") return Promise.resolve(screenshotPayload);
      if (cmd === "run_ocr_on_crop") return Promise.resolve({ text: "hello" });
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);
    const img = container.querySelector("img") as HTMLImageElement;
    await waitFor(() => expect(img.src).toContain("data:image/png;base64,AAA"));
    fireEvent.load(img);

    const overlay = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(overlay, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.mouseMove(overlay, { clientX: 300, clientY: 150 });
    fireEvent.mouseUp(overlay, { button: 0 });

    expect(canvasContext.fillRect).not.toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(canvasContext.fillRect).toHaveBeenCalledWith(100, 50, 200, 100);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("run_ocr_on_crop", {
        x: 200,
        y: 100,
        w: 400,
        h: 200,
      });
      expect(mockedInvoke).toHaveBeenCalledWith("finish_ocr", { text: "hello" });
    });
  });

  it("uses a detected window region on a single click", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_payload") {
        return Promise.resolve({
          ...screenshotPayload,
          smartRegions: [{ x: 400, y: 200, width: 1200, height: 800 }],
        });
      }
      if (cmd === "run_ocr_on_crop") return Promise.resolve({ text: "window text" });
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);
    const img = container.querySelector("img") as HTMLImageElement;
    await waitFor(() => expect(img.src).toContain("data:image/png;base64,AAA"));
    fireEvent.load(img);

    const overlay = container.firstElementChild as HTMLElement;
    fireEvent.mouseMove(overlay, { clientX: 300, clientY: 200 });
    expect(canvasContext.fillRect).toHaveBeenCalledWith(200, 100, 600, 400);
    fireEvent.mouseDown(overlay, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseUp(overlay, { button: 0 });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("run_ocr_on_crop", {
        x: 400,
        y: 200,
        w: 1200,
        h: 800,
      });
    });
  });

  it("cancels with plain Escape or a right click", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_screenshot_payload") return Promise.resolve(screenshotPayload);
      return Promise.resolve(undefined);
    });

    const { container } = render(<ScreenshotOverlay />);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("cancel_screenshot"));

    mockedInvoke.mockClear();
    fireEvent.contextMenu(container.firstElementChild as HTMLElement);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("cancel_screenshot"));
  });
});
