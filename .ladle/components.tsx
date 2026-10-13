import type { GlobalProvider } from "@ladle/react";
import { useState, type ReactNode } from "react";
import { resetPreviewBackend } from "./mockTauri";
import "../src/styles/tokens.css";
import "../src/styles/app.css";
import "../src/styles/settings.css";
import "../src/styles/island.css";
import "../src/styles/quick-window.css";
import "../src/styles/native-ui.css";
import "../src/styles/native-island.css";
import "./ladle.css";

function PreviewSurface({ children, label, scenario }: { children: ReactNode; label: string; scenario: string }) {
  useState(() => {
    resetPreviewBackend(label, scenario);
    localStorage.setItem("vanish-theme", "dark");
    return true;
  });
  return <div className="vt-ladle-canvas">{children}</div>;
}

export const Provider: GlobalProvider = ({ children, globalState, storyMeta = {} }) => {
  const label = typeof storyMeta.windowLabel === "string" ? storyMeta.windowLabel : "";
  const isolated = new URLSearchParams(window.location.search).has("vt-preview");
  if (label && !isolated) {
    const url = new URL(window.location.href);
    url.searchParams.set("story", globalState.story);
    url.searchParams.set("mode", "preview");
    url.searchParams.set("vt-preview", "1");
    const width = Number(storyMeta.frameWidth ?? (label === "screenshot" ? 1280 : label === "quick" ? 460 : 640));
    const height = Number(storyMeta.frameHeight ?? (label === "screenshot" ? 720 : label === "quick" ? 420 : 560));
    return <div className="vt-preview-container" style={{ maxWidth: width }}>
      <p className="vt-preview-note">本地模拟预览 · 不读写真实配置或调用翻译服务</p>
      <iframe key={globalState.story} title="VanishTrans 界面预览" src={url.href} style={{ width: "100%", height }} />
    </div>;
  }
  if (label) return <PreviewSurface key={globalState.story} label={label}
    scenario={typeof storyMeta.previewScenario === "string" ? storyMeta.previewScenario : ""}>{children}</PreviewSurface>;
  return <div className="vt-ladle-canvas">{children}</div>;
};
