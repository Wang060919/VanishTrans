import { fireEvent, render, screen } from "@testing-library/react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AboutTab, { resetAboutUpdateCache } from "./AboutTab";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.4") }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

function fakeUpdate(): Update {
  return {
    version: "0.2.0",
    downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
      onEvent({ event: "Finished", data: {} });
    }),
  } as unknown as Update;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheck.mockResolvedValue(null);
  resetAboutUpdateCache();
});

describe("AboutTab", () => {
  it("shows the running app version", async () => {
    render(<AboutTab />);
    expect(await screen.findByText("版本 0.1.4")).toBeInTheDocument();
  });

  it("auto-checks and reports up to date when no update exists", async () => {
    render(<AboutTab />);
    expect(await screen.findByText("当前已是最新版本")).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("reuses a recent check result across remounts without hitting the network", async () => {
    const first = render(<AboutTab />);
    expect(await screen.findByText("当前已是最新版本")).toBeInTheDocument();
    first.unmount();

    render(<AboutTab />);
    expect(await screen.findByText("当前已是最新版本")).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("keeps showing an in-flight install after a remount", async () => {
    const update = {
      version: "0.2.0",
      downloadAndInstall: vi.fn((onEvent: (event: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        return new Promise<void>(() => {}); // still downloading
      }),
    } as unknown as Update;
    mockCheck.mockResolvedValue(update);
    const first = render(<AboutTab />);
    fireEvent.click(await screen.findByRole("button", { name: "下载并安装" }));
    expect(update.downloadAndInstall).toHaveBeenCalled();
    expect(await screen.findByText(/正在下载更新/)).toBeInTheDocument();

    first.unmount();
    render(<AboutTab />);
    // The in-flight download survives the remount; no second check runs.
    expect(await screen.findByText(/正在下载更新 50%/)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("downloads, installs and offers a restart for a pending update", async () => {
    const update = fakeUpdate();
    mockCheck.mockResolvedValue(update);
    render(<AboutTab />);
    fireEvent.click(await screen.findByRole("button", { name: "下载并安装" }));
    expect(update.downloadAndInstall).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "重启生效" }));
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it("shows a failure hint when the check request fails", async () => {
    mockCheck.mockRejectedValueOnce(new Error("network down"));
    render(<AboutTab />);
    expect(await screen.findByText("检查失败，请稍后再试")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查" }));
    expect(await screen.findByText("当前已是最新版本")).toBeInTheDocument();
  });
});
