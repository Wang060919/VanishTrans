import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LanguageSwitcher from "../LanguageSwitcher";

describe("LanguageSwitcher", () => {
  it("maps target language changes onto the existing direction enum", () => {
    const onChange = vi.fn();
    render(<LanguageSwitcher value="auto2zh" onChange={onChange} />);

    expect(screen.getByRole("combobox", { name: "源语言" })).toHaveValue("auto");
    expect(screen.getByRole("combobox", { name: "目标语言" })).toHaveValue("zh");

    fireEvent.change(screen.getByRole("combobox", { name: "目标语言" }), {
      target: { value: "en" },
    });

    expect(onChange).toHaveBeenCalledWith("auto2en");
  });

  it("swaps fixed language directions and disables swap for automatic detection", () => {
    const onChange = vi.fn();
    const { rerender } = render(<LanguageSwitcher value="zh2en" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "交换语言" }));
    expect(onChange).toHaveBeenCalledWith("en2zh");

    rerender(<LanguageSwitcher value="auto2zh" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "交换语言" })).toBeDisabled();
  });
});
