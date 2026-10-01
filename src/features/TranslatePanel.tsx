import React, { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import IconButton from "../components/IconButton";
import FileDropZone from "./translate/FileDropZone";
import InputSection from "./translate/InputSection";
import OutputSection from "./translate/OutputSection";

interface TranslatePanelProps {
  actions?: React.ReactNode;
  inputText: string;
  onInputChange: (v: string) => void;
  outputText: string;
  error?: string | null;
  loading: boolean;
  glowActive: boolean;
  onClearGlow: () => void;
  onClear: () => void;
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
  actions,
  inputText,
  onInputChange,
  outputText,
  error = null,
  loading,
  glowActive,
  onClearGlow,
  onClear,
  onTranslate,
  onCancel,
  inputRef,
  streaming = false,
  fileStatus,
  onTranslateFile,
  translationKey,
}: TranslatePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    <FileDropZone onDrop={onTranslateFile} disabled={loading} inputRef={fileInputRef}>
      <main className="translation-workspace">
        {fileStatus && <div className="file-status" role="status">
          <FileText size={18} aria-hidden="true" /><span>{fileStatus}</span>
          {loading && <LoaderCircle size={16} className="translation-island__action-loader" aria-hidden="true" />}
        </div>}

        <div className="acrylic-panel">
          <InputSection
            inputText={inputText}
            canClear={Boolean(inputText || outputText || error || fileStatus)}
            onInputChange={onInputChange}
            onClear={onClear}
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
        <footer className="translation-toolbar">
          <div className="translation-tools">
            <IconButton icon={<FileText size={18} />} label="翻译文件" text="文件" disabled={loading} onClick={() => fileInputRef.current?.click()} />
            {actions}
          </div>
          <div className="translation-submit">
            <button type="button" className="translate-action" aria-label="翻译文本" disabled={!inputText.trim() || loading}
              onClick={() => onTranslate(ignoreCache)}>翻译</button>
            <span>Ctrl + Enter</span>
          </div>
        </footer>
      </main>
    </FileDropZone>
  );
}
