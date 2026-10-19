import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { configureLinuxShortcuts, normalizeCommandError } from "../../services/tauriBridge";

export default function LinuxShortcuts() {
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const refresh = () => { void configureLinuxShortcuts(null).then((current) => {
      if (!disposed) setLabels(current);
    }).catch(() => {}); };
    refresh();
    void listen("linux-shortcuts-stopped", refresh)
      .then((unlisten) => { if (disposed) unlisten(); else cleanup = unlisten; })
      .catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, []);
  const configure = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      setLabels(await configureLinuxShortcuts(enabled));
      if (!enabled) setMessage("快捷键已停用。");
    } catch (error) {
      const normalized = normalizeCommandError(error);
      setMessage(normalized.code === "CANCELLED" ? "已取消授权。" : normalized.message);
    } finally { setBusy(false); }
  };
  return <section>
    <p>实验性 KDE Wayland 快捷键由桌面 Portal 授权：打开窗口、截图 OCR。按键由系统选择；划词及原地替换仍不支持。</p>
    <p>不会在启动时申请权限。授权仅用于当前运行；更改按键请先停用再授权。桌面可能限制窗口抢焦点。</p>
    <button type="button" disabled={busy} onClick={() => void configure(true)}>授权桌面快捷键</button>
    <button type="button" disabled={busy} onClick={() => void configure(false)}>停用桌面快捷键</button>
    <p role="status">{busy ? "等待桌面授权，请在系统弹窗中完成或取消。" : message}</p>
    {labels.map((label) => <p key={label}>{label}</p>)}
  </section>;
}
