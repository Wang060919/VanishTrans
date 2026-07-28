import { getCurrentWindow } from "@tauri-apps/api/window";
import ScreenshotOverlay from "./ScreenshotOverlay";
import BallWindow from "./features/BallWindow";
import MainWindowApp from "./features/MainWindowApp";
import QuickTranslateWindow from "./features/QuickTranslateWindow";

export default function App() {
  const windowLabel = getCurrentWindow().label;
  if (windowLabel === "screenshot") return <ScreenshotOverlay />;
  if (windowLabel === "ball") return <BallWindow />;
  if (windowLabel === "quick") return <QuickTranslateWindow />;
  return <MainWindowApp />;
}
