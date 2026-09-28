import { Shield } from "lucide-react";
import { useCallback } from "react";
import ToggleSwitch from "../../components/ToggleSwitch";

interface PrivacyTabProps {
  loggingEnabled: boolean;
  onSetLogging: (enabled: boolean) => Promise<void>;
  notifyError: (error: unknown) => void;
}

/** Privacy tab: local logging and record behavior. */
export default function PrivacyTab({ loggingEnabled, onSetLogging, notifyError }: PrivacyTabProps) {
  const handleSetLogging = useCallback(
    async (enabled: boolean) => {
      try {
        await onSetLogging(enabled);
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, onSetLogging]
  );

  return (
    <section className="settings-section" aria-labelledby="privacy-settings-title">
      <div className="settings-section-heading">
        <Shield size={17} aria-hidden="true" />
        <div><h3 id="privacy-settings-title">隐私</h3><p>控制本地记录与日志行为。</p></div>
      </div>
      <div className="setting-field">
        <label htmlFor="logging-toggle">文件日志</label>
        <div className="setting-inline">
          <ToggleSwitch
            id="logging-toggle"
            checked={loggingEnabled}
            onChange={(next) => void handleSetLogging(next)}
          />
          <span className="setting-hint">{loggingEnabled ? "已开启" : "已关闭"}</span>
        </div>
        <p className="setting-hint">关闭后不再写入日志文件；翻译历史与翻译记忆仍按现有设置保存。</p>
      </div>
    </section>
  );
}
