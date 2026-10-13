import type { Story, StoryDefault } from "@ladle/react";
import ScreenshotOverlay from "../ScreenshotOverlay";

export default {
  title: "截图与 OCR",
  meta: { windowLabel: "screenshot", fullViewport: true },
} satisfies StoryDefault;

export const Selection: Story = () => <ScreenshotOverlay />;
Selection.storyName = "智能选区与拖拽识别";

export const LoadingError: Story = () => <ScreenshotOverlay />;
LoadingError.storyName = "截图加载失败";
LoadingError.meta = { previewScenario: "screenshot-error" };
