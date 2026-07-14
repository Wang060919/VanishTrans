import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import AnimatedList from "../AnimatedList";

describe("AnimatedList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders all children", () => {
    render(
      <AnimatedList>
        <div>first</div>
        <div>second</div>
        <div>third</div>
      </AnimatedList>
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByText("third")).toBeInTheDocument();
  });

  it("starts with items hidden (opacity 0)", () => {
    const { container } = render(
      <AnimatedList>
        <div>item</div>
      </AnimatedList>
    );
    const item = container.querySelector("[style]") as HTMLElement;
    expect(item.style.opacity).toBe("0");
  });

  it("reveals items with stagger delay", () => {
    const { container } = render(
      <AnimatedList stagger={200}>
        <div>first</div>
        <div>second</div>
      </AnimatedList>
    );
    const items = container.querySelectorAll("[style]");
    // At 50ms: first item (0ms timer) should be visible, second (200ms timer) not yet
    act(() => { vi.advanceTimersByTime(50); });
    expect((items[0] as HTMLElement).style.opacity).toBe("1");
    expect((items[1] as HTMLElement).style.opacity).toBe("0");

    // At 250ms: both should be visible
    act(() => { vi.advanceTimersByTime(200); });
    expect((items[1] as HTMLElement).style.opacity).toBe("1");
  });

  it("applies custom className", () => {
    const { container } = render(
      <AnimatedList className="my-class">
        <div>item</div>
      </AnimatedList>
    );
    expect(container.firstChild).toHaveClass("my-class");
  });

  it("renders wrapper div even with no children content", () => {
    const { container } = render(<AnimatedList>{null}</AnimatedList>);
    // Wrapper div exists but has no item divs inside
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.children.length).toBe(0);
  });
});
