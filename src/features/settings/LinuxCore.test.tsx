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
  it("does not claim persistence when the system wallet is unavailable", () => {
    render(<ApiTab baseUrl="https://example.com" model="test" hasStoredApiKey apiKeyStorage="unavailable"
      apiKeyUpdate={null} onBaseUrlChange={vi.fn()} onModelChange={vi.fn()}
      onApiKeyChange={vi.fn()} onSave={vi.fn()} profiles={[]}
      onSaveProfile={vi.fn()} onDeleteProfile={vi.fn()} onApplyProfile={vi.fn()}
      onTestConnection={vi.fn()} freeTranslation={false} onSetFreeTranslation={vi.fn()}
      notifyError={vi.fn()} />);
    expect(screen.getByPlaceholderText("本次运行可用，持久存储待确认")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("无法确认持久保存");
    expect(screen.queryByPlaceholderText("已安全保存，输入新 Key 可替换")).not.toBeInTheDocument();
  });
  it("shows system storage only after the backend confirms availability", () => {
    render(<ApiTab baseUrl="https://example.com" model="test" hasStoredApiKey apiKeyStorage="secret-service"
      apiKeyUpdate={null} onBaseUrlChange={vi.fn()} onModelChange={vi.fn()}
      onApiKeyChange={vi.fn()} onSave={vi.fn()} profiles={[]}
      onSaveProfile={vi.fn()} onDeleteProfile={vi.fn()} onApplyProfile={vi.fn()}
      onTestConnection={vi.fn()} freeTranslation={false} onSetFreeTranslation={vi.fn()}
      notifyError={vi.fn()} />);
    expect(screen.getByPlaceholderText("已安全保存，输入新 Key 可替换")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("系统 Secret Service");
  });
  it("offers explicit desktop portal authorization instead of Windows hotkey editors", () => {
    render(<HotkeysTab hotkeys={[{ action: "translate", shortcut: "Alt+Q" }]}
      hotkeyLabels={{ translate: "划词翻译" }} onHotkeysChange={vi.fn()} notifyError={vi.fn()} />);
    expect(screen.getByRole("button", { name: "授权桌面快捷键" })).toBeEnabled();
    expect(screen.getByText(/划词及原地替换仍不支持/)).toBeInTheDocument();
  });
  it("never checks the upstream updater feed", async () => {
    render(<AboutTab />);
    await waitFor(() => expect(screen.getByText("版本 0.1.6")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "检查" })).toBeDisabled();
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByText(/Linux 核心版暂未提供自动更新/)).toBeInTheDocument();
  });
});
