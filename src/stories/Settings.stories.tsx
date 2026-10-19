import type { Story, StoryDefault } from "@ladle/react";
import SettingsPanel, { type SettingsTab } from "../features/SettingsPanel";
import { useConfig } from "../hooks/useConfig";

export default {
  title: "设置",
  meta: { windowLabel: "main" },
} satisfies StoryDefault;

function SettingsFixture({ initialTab }: { initialTab?: SettingsTab }) {
  const config = useConfig();

  return (
    <div className="vt-window-frame native-ui" style={{ width: 640, height: 560 }}>
      <SettingsPanel
        initialTab={initialTab}
        baseUrl={config.baseUrl}
        onBaseUrlChange={config.setBaseUrl}
        model={config.model}
        onModelChange={config.setModel}
        hasStoredApiKey={config.hasStoredApiKey}
        apiKeyStorage={config.apiKeyStorage}
        apiKeyUpdate={config.apiKeyUpdate}
        onApiKeyChange={config.setApiKeyUpdate}
        onSave={config.saveConfig}
        glossary={config.glossary}
        onGlossaryChange={config.saveGlossary}
        hotkeys={config.hotkeys}
        hotkeyLabels={config.hotkeyLabels}
        onHotkeysChange={config.saveHotkeys}
        profiles={config.profiles}
        onSaveProfile={config.saveProfile}
        onDeleteProfile={config.deleteProfile}
        onApplyProfile={config.applyProfile}
        onTestConnection={config.testConnection}
        loggingEnabled={config.loggingEnabled}
        onSetLogging={config.setLogging}
        freeTranslation={config.freeTranslation}
        onSetFreeTranslation={config.setFreeTranslation}
      />
    </div>
  );
}

export const Home: Story = () => <SettingsFixture />;
Home.storyName = "分类主页";

export const Api: Story = () => <SettingsFixture initialTab="api" />;
Api.storyName = "翻译服务";

export const Hotkeys: Story = () => <SettingsFixture initialTab="hotkeys" />;
Hotkeys.storyName = "快捷键";

export const Glossary: Story = () => <SettingsFixture initialTab="glossary" />;
Glossary.storyName = "术语表";

export const TranslationMemory: Story = () => <SettingsFixture initialTab="tm" />;
TranslationMemory.storyName = "翻译记忆";

export const Privacy: Story = () => <SettingsFixture initialTab="privacy" />;
Privacy.storyName = "隐私";

export const About: Story = () => <SettingsFixture initialTab="about" />;
About.storyName = "关于";
