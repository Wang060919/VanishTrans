import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  finishOcr,
  frontendReady,
  getApiConfig,
  getHistory,
  normalizeCommandError,
  runOcrOnCrop,
  translateStream,
} from "./tauriBridge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

describe("tauriBridge", () => {
  beforeEach(() => invokeMock.mockReset());

  it("maps service profile wire fields at the boundary", async () => {
    invokeMock.mockResolvedValue({
      baseUrl: "https://api.example.test",
      hasApiKey: true,
      model: "test-model",
      profiles: [{ name: "local", base_url: "http://localhost:1234", model: "local-model" }],
    });

    await expect(getApiConfig()).resolves.toMatchObject({
      baseUrl: "https://api.example.test",
      profiles: [{ name: "local", baseUrl: "http://localhost:1234", model: "local-model" }],
    });
    expect(invokeMock).toHaveBeenCalledWith("get_api_config");
  });

  it("wraps grouped stream requests and forwards OCR session IDs", async () => {
    invokeMock.mockResolvedValue("ok");
    await translateStream({ text: "hello", direction: "auto", requestId: 7 });
    expect(invokeMock).toHaveBeenLastCalledWith("translate_stream", {
      request: { text: "hello", direction: "auto", requestId: 7 },
    });

    await runOcrOnCrop({ sessionId: 12, x: 1, y: 2, w: 3, h: 4 });
    expect(invokeMock).toHaveBeenLastCalledWith("run_ocr_on_crop", {
      sessionId: 12,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    });

    await finishOcr({ sessionId: 12, text: "result" });
    expect(invokeMock).toHaveBeenLastCalledWith("finish_ocr", { sessionId: 12, text: "result" });
  });

  it("normalizes nullable query arguments and readiness state", async () => {
    invokeMock.mockResolvedValue([]);
    await getHistory();
    expect(invokeMock).toHaveBeenCalledWith("get_history", { query: null });

    await frontendReady(false);
    expect(invokeMock).toHaveBeenLastCalledWith("frontend_ready", { ready: false });
  });

  it("preserves structured command errors and wraps legacy values", () => {
    const structured = { code: "CANCELLED", message: "cancelled" };
    expect(normalizeCommandError(structured)).toEqual(structured);
    expect(normalizeCommandError("network down")).toEqual({ code: "UNKNOWN", message: "network down" });
  });
});
