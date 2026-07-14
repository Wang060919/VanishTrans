import { useCallback, useEffect, useRef, useState } from "react";

interface HotkeyEditorProps {
  label: string;
  value: string;
  onChange: (shortcut: string) => void;
}

/**
 * HotkeyEditor — records a keyboard shortcut from the user.
 * Displays the current shortcut and allows re-recording.
 */
export default function HotkeyEditor({ label, value, onChange }: HotkeyEditorProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore bare modifier presses
    if (["Alt", "Control", "Shift", "Meta"].includes(e.key)) return;

    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");

    // Map key names to readable labels
    const key = e.key
      .replace("ArrowUp", "↑")
      .replace("ArrowDown", "↓")
      .replace("ArrowLeft", "←")
      .replace("ArrowRight", "→")
      .replace("Escape", "Esc")
      .replace(" ", "Space");

    // Skip if only modifiers were pressed
    if (parts.length === 0) return;

    parts.push(key.length === 1 ? key.toUpperCase() : key);
    const combo = parts.join("+");
    setPending(combo);
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, handleKeyDown]);

  const handleSave = useCallback(() => {
    if (pending) {
      onChange(pending);
      setPending("");
    }
  }, [pending, onChange]);

  const handleCancel = useCallback(() => {
    setPending("");
    setRecording(false);
  }, []);

  const handleStartRecording = useCallback(() => {
    setPending("");
    setRecording(true);
  }, []);

  const displayValue = pending || value;

  return (
    <div ref={containerRef} className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-text-muted truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <kbd className="px-2 py-0.5 text-[10px] font-mono bg-surface-sunken border border-border-subtle rounded min-w-[60px] text-center text-text-secondary">
          {recording ? "按下快捷键..." : displayValue}
        </kbd>
        {recording ? (
          <button
            onClick={handleCancel}
            className="text-[10px] text-text-ghost hover:text-danger transition-colors"
          >
            取消
          </button>
        ) : pending ? (
          <>
            <button
              onClick={handleSave}
              className="text-[10px] text-primary hover:text-primary-hover font-medium transition-colors"
            >
              保存
            </button>
            <button
              onClick={handleCancel}
              className="text-[10px] text-text-ghost hover:text-danger transition-colors"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            onClick={handleStartRecording}
            className="text-[10px] text-text-ghost hover:text-primary transition-colors"
          >
            修改
          </button>
        )}
      </div>
    </div>
  );
}
