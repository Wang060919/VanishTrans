import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense } from "react";

// Each webview lazily loads only its own window bundle, so hidden windows
// never parse the full app's code.
const ScreenshotOverlay = lazy(() => import("./ScreenshotOverlay"));
const BallWindow = lazy(() => import("./features/BallWindow"));
const MainWindowApp = lazy(() => import("./features/MainWindowApp"));
const QuickTranslateWindow = lazy(() => import("./features/QuickTranslateWindow"));

const IslandPreview = import.meta.env.DEV
  ? lazy(() => import("./features/IslandPreview"))
  : null;

export default function App() {
  if (IslandPreview && new URLSearchParams(window.location.search).has("island-preview")) {
    return (
      <Suspense fallback={null}>
        <IslandPreview />
      </Suspense>
    );
  }

  const windowLabel = getCurrentWindow().label;
  let content = <MainWindowApp />;
  if (windowLabel === "screenshot") content = <ScreenshotOverlay />;
  else if (windowLabel === "ball") content = <BallWindow />;
  else if (windowLabel === "quick") content = <QuickTranslateWindow />;
  return <Suspense fallback={null}>{content}</Suspense>;
}
