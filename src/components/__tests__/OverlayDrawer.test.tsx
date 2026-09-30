import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OverlayDrawer from "../OverlayDrawer";

describe("OverlayDrawer", () => {
  it("isolates full-size settings, wraps focus and restores the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const content = (open: boolean) => <div>
      <button>background</button>
      <OverlayDrawer fullSize open={open} title="设置" onClose={vi.fn()}>
        <input aria-label="last control" />
      </OverlayDrawer>
    </div>;
    const view = render(content(true));
    const back = screen.getByRole("button", { name: "返回翻译" });
    const last = screen.getByLabelText("last control");
    expect(back).toHaveFocus();
    expect(screen.getByText("background")).toHaveAttribute("inert");
    fireEvent.keyDown(back, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(back).toHaveFocus();
    view.rerender(content(false));
    expect(opener).toHaveFocus();
    expect(screen.getByText("background")).not.toHaveAttribute("inert");
    opener.remove();
  });

  it("renders an accessible dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <OverlayDrawer open title="翻译历史" onClose={onClose}>
        <p>drawer content</p>
      </OverlayDrawer>,
    );

    expect(screen.getByRole("dialog", { name: "翻译历史" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not expose dialog content while closed", () => {
    render(
      <OverlayDrawer open={false} title="设置" onClose={vi.fn()}>
        <p>hidden content</p>
      </OverlayDrawer>,
    );

    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.queryByText("hidden content")).not.toBeInTheDocument();
  });
});
