import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import GlowBorder from "../GlowBorder";

describe("GlowBorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children", () => {
    render(<GlowBorder><div>child content</div></GlowBorder>);
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("applies glow animation when active", () => {
    const { container } = render(
      <GlowBorder active={true} color="#ff0000">
        <div>content</div>
      </GlowBorder>
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.animation).toContain("glowPulse");
    expect(wrapper.style.getPropertyValue("--glow-color")).toBe("#ff0000");
  });

  it("removes glow after duration", () => {
    const { container } = render(
      <GlowBorder active={true} duration={500}>
        <div>content</div>
      </GlowBorder>
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.animation).toContain("glowPulse");

    act(() => { vi.advanceTimersByTime(500); });
    expect(wrapper.style.animation).toBe("");
  });

  it("does not glow when active is false", () => {
    const { container } = render(
      <GlowBorder active={false}>
        <div>content</div>
      </GlowBorder>
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.animation).toBe("");
  });

  it("applies custom className", () => {
    const { container } = render(
      <GlowBorder className="my-class">
        <div>content</div>
      </GlowBorder>
    );
    expect(container.firstChild).toHaveClass("my-class");
  });
});
