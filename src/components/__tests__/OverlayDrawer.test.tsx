import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OverlayDrawer from "../OverlayDrawer";

describe("OverlayDrawer", () => {
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
