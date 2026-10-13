import type { Story, StoryDefault } from "@ladle/react";
import { useRef } from "react";
import MainWindowApp from "../features/MainWindowApp";
import { SAMPLE_RESULT } from "../../.ladle/fixtures";

export default {
  title: "主界面",
  meta: { windowLabel: "main" },
} satisfies StoryDefault;

export const Empty: Story = () => <div className="vt-window-frame"><MainWindowApp /></div>;
Empty.storyName = "空白与交互";
export const Result: Story = () => <div className="vt-window-frame"><MainWindowApp resultToOpen={SAMPLE_RESULT} /></div>;
Result.storyName = "翻译结果";
const longResult = {
  ...SAMPLE_RESULT, requestId: 2,
  source: Array.from({ length: 8 }, (_, index) =>
    `Paragraph ${index + 1}: A good reading experience gives the text enough room to breathe. Keep the original available while allowing the reader to focus on the translation. Returning to editing should preserve the text and reading position.`).join("\n\n"),
  text: Array.from({ length: 8 }, (_, index) =>
    `第 ${index + 1} 段：良好的阅读体验，需要给文字留出足够的空间。当译文超过几句话时，狭小的预览区域会让人难以连贯地理解内容。原文应随时可查看，阅读时则可以将它收起。返回编辑后，输入内容、光标和阅读位置都应保留。`).join("\n\n"),
};
export const LongResult: Story = () => <div className="vt-window-frame"><MainWindowApp resultToOpen={longResult} /></div>;
LongResult.storyName = "长译文阅读";
export const Wide: Story = () => <div className="vt-window-frame" style={{ width: "100%", height: 720 }}><MainWindowApp resultToOpen={SAMPLE_RESULT} /></div>;
Wide.storyName = "宽屏布局";
Wide.meta = { frameWidth: 1180, frameHeight: 720 };
export const Error: Story = () => <div className="vt-window-frame"><MainWindowApp /></div>;
Error.storyName = "请求失败与重试";
Error.meta = { previewScenario: "translation-error" };
export const Notice: Story = () => <div className="vt-window-frame"><MainWindowApp /></div>;
Notice.storyName = "启动提示";
Notice.meta = { previewScenario: "startup-warning" };

function FileTranslationPreview() {
  const scopeRef = useRef<HTMLDivElement>(null);
  const loadSample = () => {
    const input = scopeRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input || input.disabled) return;
    const subtitles = [
      "1", "00:00:01,000 --> 00:00:03,000", "Hello, world.", "",
      "2", "00:00:04,000 --> 00:00:07,000", "Translation memory keeps useful results.", "",
      "3", "00:00:08,000 --> 00:00:11,000", "Choose a region to translate the text.", "",
    ].join("\n");
    const transfer = new DataTransfer();
    transfer.items.add(new File([subtitles], "preview.srt", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <div ref={scopeRef} className="vt-story-stack">
      <div className="vt-story-row">
        <button type="button" className="secondary-button" onClick={loadSample}>
          载入示例字幕
        </button>
      </div>
      <div className="vt-window-frame"><MainWindowApp /></div>
    </div>
  );
}

export const FileTranslation: Story = () => <FileTranslationPreview />;
FileTranslation.storyName = "文件翻译";
FileTranslation.meta = { frameHeight: 640 };
