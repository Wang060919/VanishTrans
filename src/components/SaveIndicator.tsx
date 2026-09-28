import { Check } from "lucide-react";

interface SaveIndicatorProps {
  saved: boolean;
  error?: string;
}

/** Transient "settings saved" tick, or a persistent error line. */
export default function SaveIndicator({ saved, error = "" }: SaveIndicatorProps) {
  if (error) {
    return (
      <div className="save-indicator save-indicator--visible save-indicator--error" role="alert">
        {error}
      </div>
    );
  }
  return (
    <div className={`save-indicator ${saved ? "save-indicator--visible" : ""}`} role="status">
      <Check size={13} aria-hidden="true" />
      设置已保存
    </div>
  );
}
