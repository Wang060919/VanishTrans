import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import FileDropZone from "./FileDropZone";

function dropFile(container: HTMLElement, file: File) {
  const zone = container.querySelector(".translation-drop-zone");
  if (!zone) throw new Error("drop zone not rendered");
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
}

describe("FileDropZone decoding", () => {
  it("passes UTF-8 file content through unchanged", async () => {
    const onDrop = vi.fn();
    const { container } = render(
      <FileDropZone onDrop={onDrop}><div /></FileDropZone>,
    );
    dropFile(container, new File(["héllo 世界\n\nbye"], "a.txt"));
    await vi.waitFor(() => expect(onDrop).toHaveBeenCalledWith("a.txt", "héllo 世界\n\nbye"));
  });

  it("decodes GBK-encoded files with the GB18030 fallback", async () => {
    const onDrop = vi.fn();
    const { container } = render(
      <FileDropZone onDrop={onDrop}><div /></FileDropZone>,
    );
    // "你好世界" in GBK — not valid UTF-8, so strict decoding must fail first.
    const gbk = new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7]);
    dropFile(container, new File([gbk], "subs.srt"));
    await vi.waitFor(() => expect(onDrop).toHaveBeenCalledWith("subs.srt", "你好世界"));
  });

  it("honours a UTF-16LE BOM like readAsText did", async () => {
    const onDrop = vi.fn();
    const { container } = render(
      <FileDropZone onDrop={onDrop}><div /></FileDropZone>,
    );
    const bytes = new Uint8Array([0xFF, 0xFE, 0x60, 0x4F, 0x7D, 0x59]); // 你好
    dropFile(container, new File([bytes], "a.txt"));
    await vi.waitFor(() => expect(onDrop).toHaveBeenCalledWith("a.txt", "你好"));
  });

  it("rejects files over the 10 MB limit", async () => {
    const onDrop = vi.fn();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { container } = render(
      <FileDropZone onDrop={onDrop}><div /></FileDropZone>,
    );
    dropFile(container, new File([new Uint8Array(11 * 1024 * 1024)], "big.txt"));
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    expect(onDrop).not.toHaveBeenCalled();
  });
});
