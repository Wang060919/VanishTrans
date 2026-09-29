import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import SettingsPanel from "./SettingsPanel";

vi.mock("./settings/TmTab", () => ({ default: () => <div>翻译记忆内容</div> }));
const profile = { name: "常用", baseUrl: "https://example.test", model: "test-model" };
function props(): ComponentProps<typeof SettingsPanel> {
  return {
    initialTab: "api", baseUrl: profile.baseUrl, model: profile.model, hasStoredApiKey: true, apiKeyUpdate: null,
    onBaseUrlChange: vi.fn(), onModelChange: vi.fn(), onApiKeyChange: vi.fn(), onSave: vi.fn(async () => {}),
    glossary: [], onGlossaryChange: vi.fn(async () => {}), hotkeys: [], hotkeyLabels: {},
    onHotkeysChange: vi.fn(async () => {}), profiles: [profile],
    onSaveProfile: vi.fn(async () => [profile]), onDeleteProfile: vi.fn(async () => []),
    onApplyProfile: vi.fn(async () => profile), onTestConnection: vi.fn(async () => "连接成功"),
    loggingEnabled: false, onSetLogging: vi.fn(async () => {}),
    freeTranslation: false, onSetFreeTranslation: vi.fn(async () => {}),
  };
}
function Harness() {
  const [freeTranslation, setFreeTranslation] = useState(false);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  return <SettingsPanel {...props()} baseUrl={baseUrl} onBaseUrlChange={setBaseUrl}
    freeTranslation={freeTranslation} onSetFreeTranslation={async (value) => setFreeTranslation(value)} />;
}

describe("island settings", () => {
  it("hides API fields in Google mode and restores the edited address", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://draft.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Google 免费翻译" }));
    expect(await screen.findByText("即开即用，无需密钥")).toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自定义 API" }));
    expect(await screen.findByLabelText("Base URL")).toHaveValue("https://draft.test");
  });

  it("shows pending and failed saves and recovers after a successful retry", async () => {
    const config = props();
    let rejectSave!: (reason: Error) => void;
    config.onSave = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    const view = render(<SettingsPanel {...config} />);
    fireEvent.blur(screen.getByLabelText("Base URL"));
    expect(screen.getByRole("status")).toHaveTextContent("正在保存");
    await act(async () => { rejectSave(new Error("写入失败")); });
    expect(screen.getByRole("status")).toHaveTextContent("写入失败");
    config.onSave = vi.fn(async () => {});
    view.rerender(<SettingsPanel {...config} />);
    fireEvent.blur(screen.getByLabelText("Base URL"));
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

  it("opens grouped categories and returns focus to the originating row", () => {
    render(<SettingsPanel {...props()} initialTab={undefined} />);
    expect(screen.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    for (const label of ["翻译服务", "快捷键", "术语表", "翻译记忆", "隐私"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("region", { name: label + "设置" })).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
      expect(screen.getByRole("button", { name: label })).toHaveFocus();
    }
  });

  it("selects a saved profile without applying until explicitly requested", async () => {
    const config = props();
    render(<SettingsPanel {...config} />);
    fireEvent.click(screen.getByRole("combobox", { name: "已存配置" }));
    fireEvent.click(screen.getByRole("option", { name: /常用/ }));
    expect(config.onApplyProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(config.onApplyProfile).toHaveBeenCalledWith(profile.name);
    await screen.findByText("已保存");
    fireEvent.click(screen.getByRole("button", { name: "删除配置 常用" }));
    expect(config.onDeleteProfile).toHaveBeenCalledWith(profile.name);
    await act(async () => {});
  });

  it("keeps an unsuccessful profile name available for retry", async () => {
    const config = props();
    config.onSaveProfile = vi.fn(async () => { throw new Error("无法保存配置"); });
    render(<SettingsPanel {...config} />);
    expect(screen.queryByLabelText("配置名称")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "另存为配置" }));
    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "工作" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await screen.findByText("无法保存配置");
    expect(screen.getByLabelText("配置名称")).toHaveValue("工作");
    expect(config.onSaveProfile).toHaveBeenCalledWith({ ...profile, name: "工作" });
  });

  it("discards a connection result when its model has changed", async () => {
    const config = props();
    let resolveTest!: (message: string) => void;
    config.onTestConnection = vi.fn(() => new Promise<string>((resolve) => { resolveTest = resolve; }));
    const view = render(<SettingsPanel {...config} />);
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    view.rerender(<SettingsPanel {...config} model="new-model" />);
    await act(async () => { resolveTest("旧连接成功"); });
    expect(screen.queryByText("旧连接成功")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeEnabled();
  });

  it("preserves a batch failure when another overlapping save succeeds", async () => {
    const config = props();
    let rejectFirst!: (reason: Error) => void;
    let resolveSecond!: () => void;
    config.onSave = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSecond = resolve; }));
    render(<SettingsPanel {...config} />);
    fireEvent.blur(screen.getByLabelText("Base URL"));
    fireEvent.blur(screen.getByLabelText("模型名称"));
    await act(async () => { rejectFirst(new Error("第一次保存失败")); });
    await act(async () => { resolveSecond(); });
    expect(screen.getByRole("status")).toHaveTextContent("第一次保存失败");
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
  });
});
