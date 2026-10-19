import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import LinuxShortcuts from "./LinuxShortcuts";
import { configureLinuxShortcuts } from "../../services/tauriBridge";
vi.mock("../../services/tauriBridge", () => ({ configureLinuxShortcuts: vi.fn(), normalizeCommandError: (error: unknown) => error }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(configureLinuxShortcuts).mockResolvedValue([]); });
it("queries current state without requesting permission on mount", async () => {
  render(<LinuxShortcuts />);
  await waitFor(() => expect(configureLinuxShortcuts).toHaveBeenCalledWith(null));
  expect(configureLinuxShortcuts).not.toHaveBeenCalledWith(true);
});
it("requires explicit authorization and reports cancellation", async () => {
  vi.mocked(configureLinuxShortcuts).mockImplementation(async (enabled) => {
    if (enabled) throw { code: "CANCELLED", message: "cancelled" };
    return [];
  });
  render(<LinuxShortcuts />);
  fireEvent.click(screen.getByRole("button", { name: "授权桌面快捷键" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已取消授权。"));
  expect(screen.getByRole("button", { name: "授权桌面快捷键" })).toBeEnabled();
});
