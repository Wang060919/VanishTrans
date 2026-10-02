import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlossaryEntry } from "../../types";
import GlossaryTab from "./GlossaryTab";

describe("GlossaryTab row identity", () => {
  it("keeps focus and all characters while auto-saving plain glossary entries", async () => {
    const onGlossaryChange = vi.fn(async (_entries: GlossaryEntry[]) => {});
    render(<GlossaryTab glossary={[{ source: "", target: "译文" }]}
      onGlossaryChange={onGlossaryChange} notifyError={vi.fn()} />);

    const source = screen.getByRole("textbox", { name: "术语原文 1" }) as HTMLInputElement;
    source.focus();
    for (const value of ["H", "He", "Hel", "Hell", "Hello"]) {
      fireEvent.change(source, { target: { value } });
      expect(screen.getByRole("textbox", { name: "术语原文 1" })).toBe(source);
      expect(source).toHaveFocus();
    }
    expect(source).toHaveValue("Hello");
    await waitFor(() => expect(onGlossaryChange).toHaveBeenLastCalledWith([
      { source: "Hello", target: "译文" },
    ]));
  });

  it("does not reuse an editing row when a preceding duplicate is deleted or a new row is added", async () => {
    const onGlossaryChange = vi.fn(async (_entries: GlossaryEntry[]) => {});
    render(<GlossaryTab
      glossary={[{ source: "same", target: "相同" }, { source: "same", target: "相同" }]}
      onGlossaryChange={onGlossaryChange} notifyError={vi.fn()} />);

    const editing = screen.getByRole("textbox", { name: "术语译文 2" }) as HTMLInputElement;
    editing.focus();
    fireEvent.change(editing, { target: { value: "第二条" } });
    fireEvent.click(screen.getByRole("button", { name: "删除术语 1" }));
    expect(screen.getByRole("textbox", { name: "术语译文 1" })).toBe(editing);
    expect(editing).toHaveFocus();
    expect(editing).toHaveValue("第二条");

    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.change(screen.getByRole("textbox", { name: "术语原文 2" }), {
      target: { value: "new" },
    });
    expect(screen.getByRole("textbox", { name: "术语译文 1" })).toBe(editing);
    expect(editing).toHaveFocus();
    await waitFor(() => expect(onGlossaryChange).toHaveBeenLastCalledWith([
      { source: "same", target: "第二条" }, { source: "new", target: "" },
    ]));
  });

  it("persists an added row through the unmount flush when the tab is left early", async () => {
    const onGlossaryChange = vi.fn(async (_entries: GlossaryEntry[]) => {});
    const { unmount } = render(<GlossaryTab
      glossary={[{ source: "same", target: "相同" }]}
      onGlossaryChange={onGlossaryChange} notifyError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    unmount();

    await waitFor(() => expect(onGlossaryChange).toHaveBeenCalledWith([
      { source: "same", target: "相同" }, { source: "", target: "" },
    ]));
  });
});
