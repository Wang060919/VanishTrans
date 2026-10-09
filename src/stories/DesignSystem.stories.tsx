import { Copy, Settings2 } from "lucide-react";
import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import IconButton from "../components/IconButton";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ToggleSwitch from "../components/ToggleSwitch";
import type { LangDirection } from "../hooks/useTranslation";

export default {
  title: "设计系统",
} satisfies StoryDefault;

const colors = [
  ["画布", "var(--color-canvas)", "--color-canvas"],
  ["表面", "var(--color-surface)", "--color-surface"],
  ["抬升层", "var(--color-surface-raised)", "--color-surface-raised"],
  ["弱表面", "var(--color-surface-subtle)", "--color-surface-subtle"],
  ["主文字", "var(--color-ink)", "--color-ink"],
  ["次级文字", "var(--color-ink-secondary)", "--color-ink-secondary"],
  ["弱化文字", "var(--color-ink-muted)", "--color-ink-muted"],
  ["状态强调", "var(--color-signal)", "--color-signal"],
] as const;

export const Foundations: Story = () => (
  <div className="vt-story-surface vt-story-stack">
    <section>
      <p className="vt-story-label">颜色令牌</p>
      <div className="vt-swatch-grid">
        {colors.map(([name, value, token]) => (
          <div className="vt-swatch" key={token}>
            <div className="vt-swatch__color" style={{ background: value }} />
            <div className="vt-swatch__meta">
              <strong>{name}</strong>
              <code>{token}</code>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <p className="vt-story-label">字体与层级</p>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 650 }}>VanishTrans 工作台</div>
        <div style={{ fontSize: 18, fontWeight: 560 }}>翻译结果标题</div>
        <div style={{ fontSize: 14, color: "var(--color-ink-secondary)" }}>
          桌面优先、默认安静、按需展开复杂能力。
        </div>
        <code style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)" }}>
          Alt+R · Smart · Expert
        </code>
      </div>
    </section>
  </div>
);

Foundations.storyName = "基础规范";

export const Controls: Story = () => {
  const [enabled, setEnabled] = useState(true);
  const [direction, setDirection] = useState<LangDirection>("auto");

  return (
    <div className="vt-story-surface vt-story-stack native-ui">
      <section>
        <p className="vt-story-label">图标按钮</p>
        <div className="vt-story-row">
          <IconButton icon={<Copy size={16} />} label="复制" onClick={() => undefined} />
          <IconButton icon={<Settings2 size={16} />} label="设置" active onClick={() => undefined} />
          <IconButton icon={<Copy size={16} />} label="复制" disabled onClick={() => undefined} />
        </div>
      </section>

      <section>
        <p className="vt-story-label">开关</p>
        <div className="vt-story-row">
          <ToggleSwitch id="ladle-toggle" checked={enabled} onChange={setEnabled} />
          <label htmlFor="ladle-toggle" style={{ color: "var(--color-ink-secondary)", fontSize: 13 }}>
            {enabled ? "已开启" : "已关闭"}
          </label>
        </div>
      </section>

      <section style={{ maxWidth: 360 }}>
        <p className="vt-story-label">语言切换</p>
        <LanguageSwitcher value={direction} onChange={setDirection} />
      </section>
    </div>
  );
};
Controls.storyName = "控件";
