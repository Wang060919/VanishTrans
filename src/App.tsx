import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense } from "react";
import ScreenshotOverlay from "./ScreenshotOverlay";
import BallWindow from "./features/BallWindow";
import MainWindowApp from "./features/MainWindowApp";
import QuickTranslateWindow from "./features/QuickTranslateWindow";

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
  if (windowLabel === "screenshot") return <ScreenshotOverlay />;
  if (windowLabel === "ball") return <BallWindow />;
  if (windowLabel === "quick") return <QuickTranslateWindow />;
  return <MainWindowApp />;
}
