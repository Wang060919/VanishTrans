import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import Typewriter from "../Typewriter";

describe("Typewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty span", () => {
    const { container } = render(<Typewriter text="hello" speed={50} />);
    const span = container.querySelector("span");
    expect(span).toBeInTheDocument();
    expect(span?.textContent).toBe("");
  });

  it("reveals characters over time", () => {
    render(<Typewriter text="hi" speed={50} />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText("h")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("completes the full text", () => {
    render(<Typewriter text="ok" speed={10} />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("handles empty text without crash", () => {
    const { container } = render(<Typewriter text="" speed={50} />);
    const span = container.querySelector("span");
    expect(span).toBeInTheDocument();
    expect(span?.textContent).toBe("");
  });

  it("clamps speed to minimum of 1", () => {
    render(<Typewriter text="ab" speed={0} />);
    act(() => { vi.advanceTimersByTime(10); });
    expect(screen.getByText("ab")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<Typewriter text="x" speed={50} className="my-class" />);
    expect(container.querySelector("span")).toHaveClass("my-class");
  });
});
