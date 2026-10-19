import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLinuxOcr } from "./useLinuxOcr";
import { linuxScreenshotOcr } from "../services/tauriBridge";
vi.mock("../services/tauriBridge", () => ({
  linuxScreenshotOcr: vi.fn(),
  normalizeCommandError: (error: unknown) => error,
}));
beforeEach(() => vi.clearAllMocks());
describe("local OCR draft lifecycle", () => {
  it("keeps recognition as an editable draft until user applies it", async () => {
    vi.mocked(linuxScreenshotOcr).mockResolvedValue("recognized");
    const { result } = renderHook(() => useLinuxOcr());
    await act(() => result.current.start());
    expect(result.current.text).toBe("recognized");
    act(() => result.current.setText("corrected"));
    expect(result.current.text).toBe("corrected");
    act(() => result.current.dismiss());
    expect(result.current.text).toBeNull();
  });
  it("does not retain stale output after a cancelled recapture", async () => {
    vi.mocked(linuxScreenshotOcr).mockResolvedValueOnce("old").mockRejectedValueOnce({ code: "CANCELLED", message: "cancelled" });
    const { result } = renderHook(() => useLinuxOcr());
    await act(() => result.current.start());
    await act(() => result.current.start());
    expect(result.current.text).toBeNull();
    expect(result.current.error).toBe("已取消截图。");
    expect(result.current.busy).toBe(false);
  });
  it("reports unavailable OCR and clears the busy state", async () => {
    vi.mocked(linuxScreenshotOcr).mockRejectedValue({ code: "NOT_FOUND", message: "Install Tesseract" });
    const { result } = renderHook(() => useLinuxOcr());
    await act(() => result.current.start());
    expect(result.current.text).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe("Install Tesseract");
  });
  it("deduplicates repeated capture clicks", async () => {
    let finish!: (text: string) => void;
    vi.mocked(linuxScreenshotOcr).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLinuxOcr());
    act(() => { void result.current.start(); void result.current.start(); });
    expect(linuxScreenshotOcr).toHaveBeenCalledTimes(1);
    await act(async () => finish("draft"));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });
});
