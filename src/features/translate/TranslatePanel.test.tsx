import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import TranslatePanel from "../TranslatePanel";

vi.mock("../../services/tauriBridge", () => ({ readClipboardSafe: vi.fn(), writeClipboardSafe: vi.fn() }));

function props(): ComponentProps<typeof TranslatePanel> {
  return { inputText: "Hello", outputText: "你好", onInputChange: vi.fn(), onClear: vi.fn(), loading: false,
    glowActive: false, onClearGlow: vi.fn(), onTranslate: vi.fn(), inputRef: createRef<HTMLTextAreaElement>(),
    fileStatus: null, onTranslateFile: vi.fn(), translationKey: 1 };
}

describe("native translation controls", () => {
  it("keeps Enter for newlines, ignores IME confirmation, and translates with Ctrl+Enter", () => {
    const config = props();
    render(<TranslatePanel {...config} />);
    const input = screen.getByRole("textbox", { name: "原文" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(config.onTranslate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(config.onTranslate).toHaveBeenCalledWith(false);
  });

  it("resets the whole session and refocuses the input via 清空", () => {
    const config = props();
    render(<TranslatePanel {...config} />);
    const input = screen.getByRole("textbox", { name: "原文" });
    fireEvent.click(screen.getByRole("button", { name: "清空输入与译文" }));
    expect(config.onClear).toHaveBeenCalled();
    expect(config.onInputChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("keeps 清空 available while only output remains", () => {
    const config = props();
    render(<TranslatePanel {...config} inputText="" />);
    expect(screen.getByRole("button", { name: "清空输入与译文" })).toBeInTheDocument();
  });

  it("uses the same cache preference for the toolbar and keyboard", () => {
    const config = props();
    render(<TranslatePanel {...config} />);
    fireEvent.click(screen.getByRole("button", { name: "忽略缓存" }));
    fireEvent.click(screen.getByRole("button", { name: "翻译文本" }));
    expect(config.onTranslate).toHaveBeenCalledWith(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "原文" }), { key: "Enter", ctrlKey: true });
    expect(config.onTranslate).toHaveBeenLastCalledWith(true);
  });

  it("reads a selected file through the existing translation callback", async () => {
    const config = props();
    render(<TranslatePanel {...config} />);
    const file = new File(["A source line"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("选择翻译文件"), { target: { files: [file] } });
    await waitFor(() => expect(config.onTranslateFile).toHaveBeenCalledWith("notes.txt", "A source line"));
  });

  it("disables the toolbar and keyboard while the shared session is busy", () => {
    const config = props();
    render(<TranslatePanel {...config} loading />);
    expect(screen.getByRole("button", { name: "翻译文本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "翻译文件" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "原文" }), { key: "Enter", ctrlKey: true });
    expect(config.onTranslate).not.toHaveBeenCalled();
  });
});
