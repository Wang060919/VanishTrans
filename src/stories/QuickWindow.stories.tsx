import type { Story, StoryDefault } from "@ladle/react";
import { emit } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { SAMPLE_SOURCE, SAMPLE_TEXT } from "../../.ladle/fixtures";
import QuickTranslateWindow from "../features/QuickTranslateWindow";
import QuickTranslationView from "../features/QuickTranslationView";
import { hideQuickWindow, showMainWithText } from "../services/tauriBridge";

export default {
  title: "迷你翻译窗口",
  meta: { windowLabel: "quick" },
} satisfies StoryDefault;

interface FixtureProps {
  source?: string;
  output?: string;
  error?: string;
  loading?: boolean;
  editing?: boolean;
}

function QuickFixture({
  source: initialSource = SAMPLE_SOURCE,
  output: initialOutput = "",
  error: initialError = "",
  loading: initialLoading = false,
  editing: initialEditing = false,
}: FixtureProps) {
  const [source, setSource] = useState(initialSource);
  const [output, setOutput] = useState(initialOutput);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(initialLoading);
  const [editing, setEditing] = useState(initialEditing);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1100);
    return () => clearTimeout(timer);
  }, [copied]);

  const retry = () => {
    if (!source.trim()) return;
    setError("");
    setLoading(false);
    setEditing(false);
    setCopied(false);
    setOutput(SAMPLE_TEXT);
  };

  return (
    <div className="vt-quick-stage" style={{ width: 392 }}>
      <QuickTranslationView
        source={source}
        output={output}
        error={error}
        loading={loading}
        editing={editing}
        copied={copied}
        onSourceChange={setSource}
        onCopy={() => setCopied(true)}
        onRetry={retry}
        onClose={() => void hideQuickWindow()}
        onExpand={() => void showMainWithText({ text: source })}
      />
    </div>
  );
}

export const Idle: Story = () => <QuickFixture source="" />;
Idle.storyName = "空闲";

export const Loading: Story = () => <QuickFixture loading />;
Loading.storyName = "正在翻译";

export const Result: Story = () => <QuickFixture output={SAMPLE_TEXT} />;
Result.storyName = "翻译完成";

export const LongResult: Story = () => (
  <QuickFixture output={Array.from({ length: 8 }, () => SAMPLE_TEXT).join("\n\n")} />
);
LongResult.storyName = "长译文滚动";

export const RequestError: Story = () => (
  <QuickFixture error="请求超时，请检查网络后重试。" />
);
RequestError.storyName = "翻译失败与重试";

export const OcrEditing: Story = () => <QuickFixture editing />;
OcrEditing.storyName = "确认 OCR 文本";

export const Interactive: Story = () => (
  <div className="vt-story-stack">
    <div className="vt-story-row">
      <button
        type="button"
        className="secondary-button"
        onClick={() => void emit("quick-translate", SAMPLE_SOURCE)}
      >
        翻译选中文字
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void emit("quick-translate", { text: SAMPLE_SOURCE, edit: true })}
      >
        确认 OCR 文本
      </button>
    </div>
    <div className="vt-quick-stage" style={{ width: 392 }}>
      <QuickTranslateWindow />
    </div>
  </div>
);
Interactive.storyName = "真实窗口交互";
