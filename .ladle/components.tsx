import type { GlobalProvider } from "@ladle/react";
import "../src/styles/tokens.css";
import "../src/styles/app.css";
import "../src/styles/settings.css";
import "../src/styles/island.css";
import "../src/styles/quick-window.css";
import "../src/styles/native-ui.css";
import "../src/styles/native-island.css";
import "./ladle.css";

export const Provider: GlobalProvider = ({ children }) => (
  <div className="vt-ladle-canvas">{children}</div>
);
