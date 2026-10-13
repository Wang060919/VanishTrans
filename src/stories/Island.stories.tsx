import type { Story, StoryDefault } from "@ladle/react";
import MainWindowApp from "../features/MainWindowApp";
import IslandResultPanel from "../features/IslandResultPanel";
import { SAMPLE_RESULT } from "../../.ladle/fixtures";
import TranslationIslandView, {
  type IslandMode,
  type IslandPhase,
} from "../features/TranslationIslandView";

export default {
  title: "灵动岛 / 状态",
  meta: { windowLabel: "main", frameWidth: 680, frameHeight: 650 },
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
          fullContent={<MainWindowApp embedded resultToOpen={SAMPLE_RESULT} />}
          resultContent={<IslandResultPanel result={SAMPLE_RESULT} preview
            onExpand={() => undefined} onClose={() => undefined} />}
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
export const Peek: Story = () => <IslandFixture mode="peek" />;
Peek.storyName = "悬停预览";
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
