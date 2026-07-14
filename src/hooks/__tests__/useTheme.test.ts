import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("persists explicit theme choices on the document root", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("vanish-theme")).toBe("dark");

    act(() => result.current.setTheme("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
