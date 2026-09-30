import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OverlayDrawer from "../../components/OverlayDrawer";
import ProfileSelect from "./ProfileSelect";

const profiles = [
  { name: "Alpha", model: "model-a", baseUrl: "https://example.test" },
  { name: "Beta", model: "model-b", baseUrl: "https://example.test" },
];

describe("ProfileSelect", () => {
  it("uses a custom popup and only commits the explicitly chosen option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProfileSelect profiles={profiles} value="Alpha" disabled={false} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "已存配置" });
    await user.click(trigger);
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("option", { name: /Alpha/ })).toHaveAttribute("aria-selected", "true");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith("Beta");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports arrows, Home, End, typeahead and Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProfileSelect profiles={profiles} value="" disabled={false} onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await user.keyboard("{ArrowDown}{End}{Home}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("Beta");
    await user.keyboard("a{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("Alpha");
  });

  it("closes only the menu on first Escape, then closes the settings dialog", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<OverlayDrawer open fullSize title="设置" onClose={close}>
      <ProfileSelect profiles={profiles} value="Alpha" disabled={false} onChange={vi.fn()} />
      <button>应用</button>
    </OverlayDrawer>);
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);
    const menu = screen.getByRole("listbox");
    expect(screen.getByRole("dialog")).toContainElement(menu);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes on Tab without selecting or losing the next control", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<><ProfileSelect profiles={profiles} value="" disabled={false} onChange={onChange} /><button>应用</button></>);
    await user.click(screen.getByRole("combobox"));
    await user.tab();
    expect(screen.getByRole("button", { name: "应用" })).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dismisses outside, on container scroll, and when disabled", () => {
    const view = render(<ProfileSelect profiles={profiles} value="" disabled={false} onChange={vi.fn()} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.scroll(window);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    view.rerender(<ProfileSelect profiles={profiles} value="" disabled onChange={vi.fn()} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toBeDisabled();
  });
});
