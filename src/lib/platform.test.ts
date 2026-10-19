import { afterEach, describe, expect, it } from "vitest";
import { isLinuxCore } from "./platform";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("Linux core shell mode", () => {
  it("keeps the existing shell unless explicitly selected", () => {
    window.history.replaceState(null, "", "/");
    expect(isLinuxCore()).toBe(false);
  });
  it("uses the ordinary desktop shell for the Linux configuration", () => {
    window.history.replaceState(null, "", "/?linux-core");
    expect(isLinuxCore()).toBe(true);
  });
});
