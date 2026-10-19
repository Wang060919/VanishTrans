import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import ApiTab from "./ApiTab";
import HotkeysTab from "./HotkeysTab";
import AboutTab, { resetAboutUpdateCache } from "./AboutTab";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.6") }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

beforeEach(() => {
  window.history.replaceState(null, "", "/?linux-core");
  vi.clearAllMocks();
  resetAboutUpdateCache();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("Linux core capability disclosure", () => {
  it("labels an API key as session-only instead of safely persisted", () => {
    render(<ApiTab baseUrl="https://example.com" model="test" hasStoredApiKey
      apiKeyUpdate={null} onBaseUrlChange={vi.fn()} onModelChange={vi.fn()}
      onApiKeyChange={vi.fn()} onSave={vi.fn()} profiles={[]}
      onSaveProfile={vi.fn()} onDeleteProfile={vi.fn()} onApplyProfile={vi.fn()}
      onTestConnection={vi.fn()} freeTranslation={false} onSetFreeTranslation={vi.fn()}
      notifyError={vi.fn()} />);
    expect(screen.getByPlaceholderText("本次运行已设置，输入新 Key 可替换")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("不写入配置文件");
    expect(screen.queryByPlaceholderText("已安全保存，输入新 Key 可替换")).not.toBeInTheDocument();
  });
  it("does not offer unsupported hotkey editors", () => {
    render(<HotkeysTab hotkeys={[{ action: "translate", shortcut: "Alt+Q" }]}
      hotkeyLabels={{ translate: "划词翻译" }} onHotkeysChange={vi.fn()} notifyError={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("暂不支持全局快捷键");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("never checks the upstream updater feed", async () => {
    render(<AboutTab />);
    await waitFor(() => expect(screen.getByText("版本 0.1.6")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "检查" })).toBeDisabled();
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByText(/Linux 核心版暂未提供自动更新/)).toBeInTheDocument();
  });
});
