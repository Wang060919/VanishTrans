import { useRef, useState, type CSSProperties } from "react";
import type { LangDirection } from "../hooks/useTranslation";
import MainLayout from "../layouts/MainLayout";
import TranslationIslandView from "./TranslationIslandView";
import {
  getIslandGeometry,
  type BallAction,
  type DockSide,
  type IslandMode,
  type IslandPhase,
  type IslandPresentation,
} from "./islandModel";
import "./IslandPreview.css";

const MODES: IslandMode[] = ["idle", "peek", "actions", "status", "full"];
const PHASES: IslandPhase[] = ["working", "done", "error"];
const BUSY_ACTIONS: BallAction[] = ["clipboard", "screenshot", "main"];
const DOCK_SIDES: DockSide[] = ["left", "center", "right"];

function readOption<T extends string>(value: string | null, options: readonly T[], fallback: T) {
  return value && options.includes(value as T) ? value as T : fallback;
}

export default function IslandPreview() {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<IslandMode>(() => (
    readOption(params.get("mode"), MODES, "actions")
  ));
  const dockSide = readOption(params.get("dock"), DOCK_SIDES, "center");
  const phase = readOption(params.get("phase"), PHASES, "working");
  const busyAction = readOption<BallAction | "">(
    params.get("busy"),
    ["", ...BUSY_ACTIONS],
    "",
  ) || null;
  const noticeParam = params.get("notice");
  const notice = noticeParam === null
    ? ""
    : noticeParam || "暂时无法连接翻译服务";
  const interactive = params.get("animate") === "1";
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [direction, setDirection] = useState<LangDirection>("auto");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dimensions = getIslandGeometry(mode);
  const presentation: IslandPresentation = {
    mode,
    motion: interactive ? "animated" : "instant",
    phase: "stable",
    generation: 0,
  };
  const frameStyle = {
    "--island-preview-width": `${dimensions.width}px`,
    "--island-preview-height": `${dimensions.height}px`,
  } as CSSProperties;

  return (
    <main className="island-preview" data-preview-mode={mode}>
      <div className="island-preview__frame" style={frameStyle}>
        <TranslationIslandView
          presentation={presentation}
          phase={phase}
          dockSide={dockSide}
          busyAction={busyAction}
          notice={notice}
          shouldReduceMotion={!interactive}
          fullContent={(
            <MainLayout
              embedded
              onCollapse={() => {
                if (interactive) setMode("idle");
              }}
              inputText={inputText}
              onInputChange={setInputText}
              outputText={outputText}
              loading={false}
              pinned={false}
              onPin={() => {}}
              direction={direction}
              onDirectionChange={setDirection}
              glowActive={false}
              onClearGlow={() => {}}
              onTranslate={() => setOutputText(inputText.trim())}
              inputRef={inputRef}
              baseUrl="https://api.openai.com"
              onBaseUrlChange={() => {}}
              model="gpt-4o-mini"
              onModelChange={() => {}}
              hasStoredApiKey={false}
              apiKeyUpdate={null}
              onApiKeyChange={() => {}}
              onSaveConfig={async () => {}}
              glossary={[]}
              onGlossaryChange={async () => {}}
              hotkeys={[]}
              hotkeyLabels={{}}
              onHotkeysChange={async () => {}}
              profiles={[]}
              onSaveProfile={async () => []}
              onDeleteProfile={async () => []}
              onApplyProfile={async () => ({ name: "", baseUrl: "", model: "" })}
              onTestConnection={async () => ""}
              loggingEnabled
              onSetLogging={async () => {}}
              freeTranslation={false}
              onSetFreeTranslation={async () => {}}
              streaming={false}
              fileStatus={null}
              onTranslateFile={(_filename, content) => setInputText(content)}
              translationKey={0}
            />
          )}
          onRunAction={(action) => {
            if (interactive && action === "main") setMode("full");
          }}
          onCoreClick={() => {
            if (!interactive) return;
            setMode((current) => {
              if (current === "idle" || current === "peek") return "actions";
              if (current === "actions") return "idle";
              return current;
            });
          }}
          onCorePointerDown={() => {}}
          onCorePointerMove={() => {}}
          onCorePointerUp={() => {}}
          onCorePointerCancel={() => {}}
          onIslandBlur={() => {}}
        />
      </div>
    </main>
  );
}
