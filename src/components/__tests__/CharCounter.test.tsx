import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CharCounter from "../CharCounter";

describe("CharCounter", () => {
  it("displays current and max count", () => {
    render(<CharCounter current={100} max={10000} />);
    expect(screen.getByText(/100.*10,000/)).toBeInTheDocument();
  });

  it("shows zero count", () => {
    render(<CharCounter current={0} max={10000} />);
    expect(screen.getByText(/0.*10,000/)).toBeInTheDocument();
  });

  it("shows max count at 100%", () => {
    render(<CharCounter current={10000} max={10000} />);
    expect(screen.getByText(/10,000.*10,000/)).toBeInTheDocument();
  });

  it("clamps ratio at 100% when current exceeds max", () => {
    render(<CharCounter current={15000} max={10000} />);
    expect(screen.getByText(/15,000.*10,000/)).toBeInTheDocument();
  });

  it("applies warning style when >= 90%", () => {
    render(<CharCounter current={9000} max={10000} />);
    const span = screen.getByText(/9,000.*10,000/);
    expect(span.className).toContain("text-danger");
  });

  it("does not apply warning style below 90%", () => {
    render(<CharCounter current={8999} max={10000} />);
    const span = screen.getByText(/8,999.*10,000/);
    expect(span.className).not.toContain("text-danger");
  });

  it("applies custom className", () => {
    const { container } = render(<CharCounter current={0} max={100} className="my-class" />);
    expect(container.firstChild).toHaveClass("my-class");
  });
});
