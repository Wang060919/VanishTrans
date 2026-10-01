import { useCallback, useEffect, useRef, useState } from "react";
import { setShortcutsSuspended as setShortcutsSuspendedCmd } from "../services/tauriBridge";

interface HotkeyEditorProps {
  label: string;
  value: string;
  onChange: (shortcut: string) => void;
}

/**
 * Physical key codes (KeyboardEvent.code) are layout-independent: Shift+2 on
 * a US layout still reports "Digit2", and an AZERTY digit row reports
 * "DigitN" regardless of the produced character. The backend registers
 * virtual keys derived from the same physical positions, so recording by
 * code keeps the captured combo pressable on any layout.
 */
function codeToHotkeyKey(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "Escape") return "Esc";
  if (code === "Space") return "Space";
  return "";
}

/**
 * HotkeyEditor — records a keyboard shortcut from the user.
 * Displays the current shortcut and allows re-recording.
 */
export default function HotkeyEditor({ label, value, onChange }: HotkeyEditorProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const suspendedRef = useRef(false);

  const resumeShortcuts = useCallback(() => {
    if (!suspendedRef.current) return;
    suspendedRef.current = false;
    void setShortcutsSuspendedCmd({ suspended: false }).catch(() => {});
  }, []);

  // While recording, this app's own global hotkeys must be suspended:
  // Windows routes a registered combo to our hotkey handler instead of the
  // focused window, which would fire a real translation and swallow the
  // keypress before the editor can record it.
  const handleStartRecording = useCallback(() => {
    setPending("");
    void (async () => {
      if (!suspendedRef.current) {
        try {
          await setShortcutsSuspendedCmd({ suspended: true });
          suspendedRef.current = true;
        } catch {
          // Suspension is best-effort: unregistered combos still record fine.
        }
      }
      setRecording(true);
    })();
  }, []);

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

    // Skip if only modifiers were pressed
    if (parts.length === 0) return;

    const key = codeToHotkeyKey(e.code);
    if (!key) return;

    parts.push(key);
    setPending(parts.join("+"));
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
    resumeShortcuts();
  }, [pending, onChange, resumeShortcuts]);

  const handleCancel = useCallback(() => {
    setPending("");
    setRecording(false);
    resumeShortcuts();
  }, [resumeShortcuts]);

  // A settings tab switch unmounts mid-recording — release the suspension.
  useEffect(() => resumeShortcuts, [resumeShortcuts]);

  const displayValue = pending || value;

  return (
    <div ref={containerRef} className="hotkey-row">
      <span className="text-xs text-text-muted truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <kbd className="px-2 py-0.5 text-xs font-mono bg-surface-sunken border border-border-subtle rounded min-w-[60px] text-center text-text-secondary">
          {recording ? "按下快捷键..." : displayValue}
        </kbd>
        {recording ? (
          <button
            onClick={handleCancel}
            className="text-xs text-text-ghost hover:text-danger transition-colors"
          >
            取消
          </button>
        ) : pending ? (
          <>
            <button
              onClick={handleSave}
              className="text-xs text-primary hover:text-primary-hover font-medium transition-colors"
            >
              保存
            </button>
            <button
              onClick={handleCancel}
              className="text-xs text-text-ghost hover:text-danger transition-colors"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            onClick={handleStartRecording}
            className="text-xs text-text-ghost hover:text-primary transition-colors"
          >
            修改
          </button>
        )}
      </div>
    </div>
  );
}
