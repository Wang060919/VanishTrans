import React, { useEffect, useState } from "react";
import FileDropZone from "./translate/FileDropZone";
import InputSection from "./translate/InputSection";
import OutputSection from "./translate/OutputSection";

interface TranslatePanelProps {
  inputText: string;
  onInputChange: (v: string) => void;
  outputText: string;
  error?: string | null;
  loading: boolean;
  glowActive: boolean;
  onClearGlow: () => void;
  onTranslate: (forceRefresh?: boolean) => void;
  onCancel?: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  streaming?: boolean;
  fileStatus: string | null;
  onTranslateFile: (filename: string, content: string) => void;
  translationKey: number;
}

/**
 * TranslatePanel - Composition root for translation interface.
 * Single responsibility: compose sub-components and manage local UI state.
 * Line count: ~75 lines (well under 150 line target)
 */
export default function TranslatePanel({
  inputText,
  onInputChange,
  outputText,
  error = null,
  loading,
  glowActive,
  onClearGlow,
  onTranslate,
  onCancel,
  inputRef,
  streaming = false,
  fileStatus,
  onTranslateFile,
  translationKey,
}: TranslatePanelProps) {
  const [ignoreCache, setIgnoreCache] = useState(false);

  // Auto-clear glow effect after animation
  useEffect(() => {
    if (!glowActive) return;
    const timer = setTimeout(onClearGlow, 900);
    return () => clearTimeout(timer);
  }, [glowActive, onClearGlow]);

  const handleTranslate = (forceRefresh: boolean) => {
    onTranslate(forceRefresh);
  };

  const handleToggleIgnoreCache = () => {
    setIgnoreCache((current) => !current);
  };

  return (
    <FileDropZone onDrop={onTranslateFile} disabled={loading}>
      <main className="translation-workspace">
        {fileStatus && <div className="file-status" role="status">{fileStatus}</div>}

        <div className="acrylic-panel">
          <InputSection
            inputText={inputText}
            onInputChange={onInputChange}
            onTranslate={handleTranslate}
            loading={loading}
            inputRef={inputRef}
            ignoreCache={ignoreCache}
            onToggleIgnoreCache={handleToggleIgnoreCache}
          />

          <div
            className={`signal-divider ${loading ? "signal-divider--active" : ""} ${
              glowActive ? "signal-divider--complete" : ""
            }`}
            aria-hidden="true"
          >
            <span />
            <i />
          </div>

          <OutputSection
            outputText={outputText}
            error={error}
            loading={loading}
            streaming={streaming}
            onTranslate={handleTranslate}
            onCancel={onCancel}
            ignoreCache={ignoreCache}
            translationKey={translationKey}
          />
        </div>
      </main>
    </FileDropZone>
  );
}
