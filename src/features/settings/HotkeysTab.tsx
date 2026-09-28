import { KeyRound } from "lucide-react";
import { useCallback } from "react";
import HotkeyEditor from "../../components/HotkeyEditor";
import type { HotkeyEntry } from "../../types";

interface HotkeysTabProps {
  hotkeys: HotkeyEntry[];
  hotkeyLabels: Record<string, string>;
  onHotkeysChange: (entries: HotkeyEntry[]) => Promise<void>;
  notifyError: (error: unknown) => void;
}

/** Hotkeys tab: global shortcut editors. */
export default function HotkeysTab({ hotkeys, hotkeyLabels, onHotkeysChange, notifyError }: HotkeysTabProps) {
  const handleHotkeyChange = useCallback(
    async (action: string, shortcut: string) => {
      try {
        await onHotkeysChange(
          hotkeys.map((entry) => (entry.action === action ? { ...entry, shortcut } : entry))
        );
      } catch (error) {
        notifyError(error);
      }
    },
    [hotkeys, notifyError, onHotkeysChange]
  );

  return (
    <section className="settings-section" aria-labelledby="hotkey-settings-title">
      <div className="settings-section-heading">
        <KeyRound size={17} aria-hidden="true" />
        <div><h3 id="hotkey-settings-title">全局快捷键</h3><p>在其他应用中也可以呼出 VanishTrans。</p></div>
      </div>
      <div className="hotkey-list">
        {hotkeys.map((entry) => (
          <HotkeyEditor
            key={entry.action}
            label={hotkeyLabels[entry.action] || entry.action}
            value={entry.shortcut}
            onChange={(shortcut) => { void handleHotkeyChange(entry.action, shortcut); }}
          />
        ))}
      </div>
    </section>
  );
}
