import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import OutputSection from "./OutputSection";

const bridge = vi.hoisted(() => ({ writeClipboardSafe: vi.fn() }));
vi.mock("../../services/tauriBridge", () => bridge);

const baseProps = {
  outputText: "",
  loading: false,
  streaming: false,
  onTranslate: vi.fn(),
  ignoreCache: false,
  translationKey: 1,
};

describe("OutputSection", () => {
  it("renders genuine output that starts with ❌ as copyable text, not an error", async () => {
    const output = "❌ No, thanks. / 不，谢谢。";
    bridge.writeClipboardSafe.mockResolvedValue(undefined);
    render(<OutputSection {...baseProps} outputText={output} />);
    expect(screen.getByText(output)).toBeInTheDocument();
    expect(document.querySelector(".result-notice")).toBeNull();
    const copyButton = screen.getByRole("button", { name: "复制译文" });
    expect(copyButton).not.toBeDisabled();
    await act(async () => { fireEvent.click(copyButton); });
    expect(bridge.writeClipboardSafe).toHaveBeenCalledWith({ text: output });
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("shows the real translationError and its retry action", () => {
    const onTranslate = vi.fn();
    render(<OutputSection {...baseProps} error="网络超时" onTranslate={onTranslate} />);
    expect(screen.getByRole("alert")).toHaveTextContent("网络超时");
    const retry = screen.getByRole("button", { name: "重试翻译" });
    fireEvent.click(retry);
    expect(onTranslate).toHaveBeenCalledWith(false);
  });
});
