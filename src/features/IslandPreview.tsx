import { useRef, useState, type CSSProperties } from "react";
import type { LangDirection } from "../hooks/useTranslation";
import MainLayout from "../layouts/MainLayout";
import { useIslandPreviewMotion } from "./useIslandPreviewMotion";
import IslandResultPanel from "./IslandResultPanel";
import QuickTranslationView from "./QuickTranslationView";
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

const MODES: IslandMode[] = ["idle", "peek", "actions", "status", "result", "full"];
const PHASES: IslandPhase[] = ["working", "done", "error"];
const BUSY_ACTIONS: BallAction[] = ["clipboard", "screenshot", "main"];
const DOCK_SIDES: DockSide[] = ["left", "center", "right"];

function readOption<T extends string>(value: string | null, options: readonly T[], fallback: T) {
  return value && options.includes(value as T) ? value as T : fallback;
}

export default function IslandPreview() {
  const params = new URLSearchParams(window.location.search);
  const interactive = params.get("animate") === "1";
  const { mode, setMode, phase: visualPhase } = useIslandPreviewMotion(
    readOption(params.get("mode"), MODES, "actions"), interactive,
  );
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
  const [quickOpen, setQuickOpen] = useState(params.get("mode") === "quick");
  const [previewCopied, setPreviewCopied] = useState(false);
  const [freeTranslation, setFreeTranslation] = useState(false);
  const [inputText, setInputText] = useState(params.has("sample") ? "Good tools disappear into the work.\nThey help you stay focused on what matters." : "");
  const [outputText, setOutputText] = useState(params.has("sample") ? "好的工具会融入工作，\n让你专注于真正重要的事。" : "");
  const [direction, setDirection] = useState<LangDirection>("auto");
  const previewResult = { source: "Stay focused. Let the little things flow.",
    text: params.get("length") === "long" ? "专注眼前，让琐事自然流转。".repeat(60) : "专注眼前，让琐事自然流转。",
    direction: "en2zh" as const };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dimensions = getIslandGeometry(interactive ? "full" : mode);
  const presentation: IslandPresentation = {
    mode,
    motion: interactive ? "animated" : "instant",
    phase: visualPhase,
    generation: 0,
  };
  const frameStyle = {
    "--island-preview-width": `${dimensions.width}px`,
    "--island-preview-height": `${dimensions.height}px`,
  } as CSSProperties;

  if (quickOpen) return (
    <main className="island-preview">
      <div style={{ width: 392 }}>
        <QuickTranslationView
          source="Stay focused. Let the little things flow."
          output={params.get("length") === "long"
            ? "专注眼前，让琐事自然流转。".repeat(60)
            : "专注眼前，让琐事自然流转。"}
          loading={false}
          copied={previewCopied}
          onCopy={() => setPreviewCopied(true)}
          onExpand={() => { setQuickOpen(false); setMode("full"); }}
          onClose={() => { setQuickOpen(false); setMode("idle"); }}
          onRetry={() => {}}
        />
      </div>
    </main>
  );

  return (
    <main className="island-preview" data-preview-mode={mode}>
      <div className="island-preview__frame" style={frameStyle}>
        <TranslationIslandView
          presentation={presentation}
          phase={phase}
          hasResult={phase === "done" || mode === "result"}
          resultContent={<IslandResultPanel result={previewResult} preview
            onClose={() => setMode("idle")} onExpand={() => {
              setInputText(previewResult.source); setOutputText(previewResult.text);
              setDirection(previewResult.direction); setMode("full");
            }} />}
          dockSide={dockSide}
          busyAction={busyAction}
          notice={notice}
          shouldReduceMotion={!interactive}
          fullContent={(
            <MainLayout
              shell={{
                embedded: true,
                onCollapse: () => {
                  if (interactive) setMode("idle");
                },
              }}
              pinned={false}
              onPin={() => {}}
              translation={{
                inputText,
                onInputChange: setInputText,
                outputText,
                loading: false,
                streaming: false,
                direction,
                onDirectionChange: setDirection,
                glowActive: false,
                onClearGlow: () => {},
                onClear: () => { setInputText(""); setOutputText(""); },
                onTranslate: () => setOutputText(inputText.trim()),
                inputRef,
                fileStatus: null,
                onTranslateFile: (_filename, content) => setInputText(content),
                translationKey: 0,
              }}
              config={{
                baseUrl: "https://api.openai.com",
                onBaseUrlChange: () => {},
                model: "gpt-4o-mini",
                onModelChange: () => {},
                hasStoredApiKey: false,
                apiKeyUpdate: null,
                onApiKeyChange: () => {},
                onSaveConfig: async () => {},
                glossary: [],
                onGlossaryChange: async () => {},
                hotkeys: [],
                hotkeyLabels: {},
                onHotkeysChange: async () => {},
                profiles: params.has("profiles") ? [
                  { name: "日常翻译", baseUrl: "https://example.test", model: "gpt-4o-mini" },
                  { name: "本地服务", baseUrl: "http://localhost:11434", model: "local-model" },
                ] : [],
                onSaveProfile: async () => [],
                onDeleteProfile: async () => [],
                onApplyProfile: async () => ({ name: "", baseUrl: "", model: "" }),
                onTestConnection: async () => "",
                loggingEnabled: true,
                onSetLogging: async () => {},
                freeTranslation,
                onSetFreeTranslation: async (enabled) => setFreeTranslation(enabled),
              }}
            />
          )}
          onRunAction={(action) => {
            if (interactive && action === "main") setMode(phase === "done" ? "result" : "full");
          }}
          onCoreClick={() => {
            if (!interactive) return;
            setMode((current) => {
              if (current === "idle" || current === "peek") return "actions";
              if (current === "actions") return "idle";
              if (current === "status" && phase === "done") return "result";
              if (current === "status" && phase === "error") return "full";
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
