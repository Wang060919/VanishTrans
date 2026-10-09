import type { Story, StoryDefault } from "@ladle/react";
import TranslationIslandView, {
  type IslandMode,
  type IslandPhase,
} from "../features/TranslationIslandView";

export default {
  title: "灵动岛 / 状态",
} satisfies StoryDefault;

type FixtureProps = {
  mode: IslandMode;
  phase?: IslandPhase;
  hasResult?: boolean;
  notice?: string;
};

function IslandFixture({
  mode,
  phase = "idle",
  hasResult = false,
  notice = "",
}: FixtureProps) {
  return (
    <div className="vt-island-stage">
      <div className="vt-island-stage__frame">
        <TranslationIslandView
          presentation={{
            mode,
            motion: "instant",
            phase: "stable",
            generation: 1,
          }}
          phase={phase}
          dockSide="center"
          busyAction={null}
          notice={notice}
          shouldReduceMotion
          hasResult={hasResult}
          fullContent={
            <div className="vt-island-full-fixture">
              <strong>VanishTrans 工作台</strong>
              <span style={{ color: "var(--color-ink-muted)", marginTop: 8 }}>
                用于视觉调试的完整工作台示例。
              </span>
            </div>
          }
          resultContent={
            <div className="vt-island-result-fixture">
              <small>英语 → 中文 · 智能</small>
              <strong>翻译完成</strong>
              <span>这是 Ladle 中用于调整结果卡视觉的固定示例内容。</span>
            </div>
          }
          onRunAction={() => undefined}
          onCoreClick={() => undefined}
          onOpenActions={() => undefined}
          onCorePointerDown={() => undefined}
          onCorePointerMove={() => undefined}
          onCorePointerUp={() => undefined}
          onCorePointerCancel={() => undefined}
          onIslandBlur={() => undefined}
        />
      </div>
    </div>
  );
}

export const Idle: Story = () => <IslandFixture mode="idle" />;
Idle.storyName = "空闲";
export const Ready: Story = () => <IslandFixture mode="idle" hasResult />;
Ready.storyName = "译文就绪";
export const Actions: Story = () => <IslandFixture mode="actions" />;
Actions.storyName = "快捷操作";
export const Translating: Story = () => <IslandFixture mode="status" phase="working" />;
Translating.storyName = "正在翻译";
export const Done: Story = () => <IslandFixture mode="status" phase="done" hasResult />;
Done.storyName = "翻译完成";
export const Error: Story = () => (
  <IslandFixture mode="status" phase="error" notice="请求失败，请检查模型配置" />
);
Error.storyName = "错误";
export const Result: Story = () => <IslandFixture mode="result" phase="done" hasResult />;
Result.storyName = "结果卡片";
export const Full: Story = () => <IslandFixture mode="full" hasResult />;
Full.storyName = "完整工作台";
