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

describe("translation reading mode", () => {
  it("expands the result without replacing the editor or toolbar or translating again", () => {
    const config = props();
    const { container } = render(<TranslatePanel {...config} />);
    const workspace = screen.getByRole("main");
    const input = screen.getByRole("textbox", { name: "原文" });
    const toolbar = container.querySelector("footer.translation-toolbar");
    const result = screen.getByText("你好");
    const copyButton = screen.getByRole("button", { name: "复制译文" });
    expect(toolbar).not.toBeNull();
    expect(workspace).toHaveAttribute("data-reading", "false");

    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    expect(workspace).toHaveAttribute("data-reading", "true");
    expect(screen.getByText("原文已收起")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回编辑" })).toHaveAttribute("aria-pressed", "true");
    expect(config.inputRef.current).toBe(input);
    expect(input).toBeInTheDocument();
    expect(container.querySelector("footer.translation-toolbar")).toBe(toolbar);
    expect(result).toBeInTheDocument();
    expect(copyButton).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(workspace).toHaveAttribute("data-reading", "false");
    expect(screen.getByRole("button", { name: "展开阅读" })).toHaveAttribute("aria-pressed", "false");
    expect(config.inputRef.current).toBe(input);
    expect(container.querySelector("footer.translation-toolbar")).toBe(toolbar);
    expect(config.onTranslate).not.toHaveBeenCalled();
    expect(config.onInputChange).not.toHaveBeenCalled();
    expect(config.onClear).not.toHaveBeenCalled();
  });

  it("restores the input text, selection direction, scroll position, and focus when returning", () => {
    const config = props();
    render(<TranslatePanel {...config} inputText="The original source text" />);
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "原文" });
    input.focus();
    input.setSelectionRange(4, 12, "backward");
    input.scrollTop = 72;

    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    // A hidden editor may lose its scroll or selection during a layout change.
    input.setSelectionRange(0, 0, "forward");
    input.scrollTop = 0;
    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));

    expect(input).toHaveValue("The original source text");
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(12);
    expect(input.selectionDirection).toBe("backward");
    expect(input.scrollTop).toBe(72);
    expect(document.activeElement).toBe(input);
  });

  it("keeps streaming updates in the chosen view and preserves the result scroll position", () => {
    const config = props();
    const { container, rerender } = render(<TranslatePanel {...config} loading streaming outputText="第一段" />);
    const workspace = screen.getByRole("main");
    rerender(<TranslatePanel {...config} loading streaming outputText="第一段，第二段" />);
    expect(workspace).toHaveAttribute("data-reading", "false");

    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    const resultFrame = container.querySelector<HTMLElement>(".result-frame");
    expect(resultFrame).not.toBeNull();
    if (!resultFrame) throw new Error("Result frame was not mounted");
    resultFrame.scrollTop = 54;
    rerender(<TranslatePanel {...config} loading streaming outputText="第一段，第二段，第三段" />);

    expect(workspace).toHaveAttribute("data-reading", "true");
    expect(screen.getByText("第一段，第二段，第三段")).toBeInTheDocument();
    expect(container.querySelector(".result-frame")).toBe(resultFrame);
    expect(resultFrame.scrollTop).toBe(54);
    expect(screen.getByRole("button", { name: "复制译文" })).toBeEnabled();
    expect(config.onTranslate).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: "restores the original position after a layout-only clamp", readingProgress: null, expected: 1066 },
    { scenario: "adopts a new reading position after the user scrolls", readingProgress: 360, expected: 360 },
  ])("$scenario when returning to editing", ({ readingProgress, expected }) => {
    const config = props();
    const { container } = render(<TranslatePanel {...config} outputText={"长译文\n".repeat(80)} />);
    const workspace = screen.getByRole("main");
    const resultFrame = container.querySelector<HTMLElement>(".result-frame");
    if (!resultFrame) throw new Error("Result frame was not mounted");
    let scrollTop = 0;
    // Model real browser clamping as the reading view grows the result viewport.
    Object.defineProperties(resultFrame, {
      scrollHeight: { get: () => 1200 },
      clientHeight: { get: () => workspace.dataset.reading === "true" ? 360 : 134 },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => { scrollTop = Math.max(0, Math.min(value, resultFrame.scrollHeight - resultFrame.clientHeight)); },
      },
    });
    resultFrame.scrollTop = 1066;

    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    expect(resultFrame.scrollTop).toBe(840);
    if (readingProgress !== null) {
      resultFrame.scrollTop = readingProgress;
      fireEvent.scroll(resultFrame);
    }
    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));

    expect(resultFrame.scrollTop).toBe(expected);
    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    expect(resultFrame.scrollTop).toBe(Math.min(expected, 840));
    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(resultFrame.scrollTop).toBe(expected);
    expect(config.onTranslate).not.toHaveBeenCalled();
  });

  it("offers reading only for a result and leaves reading mode when the result is reset", () => {
    const config = props();
    const { rerender } = render(<TranslatePanel {...config} outputText="" />);
    const workspace = screen.getByRole("main");
    const input = config.inputRef.current;
    expect(screen.queryByRole("button", { name: "展开阅读" })).not.toBeInTheDocument();

    rerender(<TranslatePanel {...config} />);
    expect(workspace).toHaveAttribute("data-reading", "false");
    fireEvent.click(screen.getByRole("button", { name: "展开阅读" }));
    expect(workspace).toHaveAttribute("data-reading", "true");
    rerender(<TranslatePanel {...config} inputText="" outputText="" translationKey={2} />);

    expect(workspace).toHaveAttribute("data-reading", "false");
    expect(screen.queryByRole("button", { name: "展开阅读" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回编辑" })).not.toBeInTheDocument();
    expect(config.inputRef.current).toBe(input);
    expect(screen.getByRole("button", { name: "复制译文" })).toBeDisabled();
  });
});
