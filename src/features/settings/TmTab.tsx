import { Database } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ToggleSwitch from "../../components/ToggleSwitch";
import { errorMessage } from "../../lib/errors";
import { logError } from "../../lib/logger";
import { getTmDir, setTmDir } from "../../services/tauriBridge";
import TmPanel from "../TmPanel";

/** Storage location block: where tm.db lives. Applied on next launch. */
function TmDirSection() {
  const [currentDir, setCurrentDir] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [input, setInput] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getTmDir()
      .then((info) => {
        setCurrentDir(info.path);
        setIsDefault(info.is_default);
      })
      .catch((error: unknown) => {
        logError("tm", `读取翻译记忆位置失败: ${errorMessage(error)}`, error);
      });
  }, []);

  const apply = useCallback(
    async (path: string) => {
      setBusy(true);
      try {
        await setTmDir({ path, migrate });
        const info = await getTmDir();
        setCurrentDir(info.path);
        setIsDefault(info.is_default);
        setInput("");
        setSaved(true);
      } catch (error: unknown) {
        window.alert(`设置失败: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [migrate]
  );

  return (
    <section className="settings-section" aria-labelledby="tm-dir-title">
      <div className="settings-section-heading">
        <Database size={17} aria-hidden="true" />
        <div><h3 id="tm-dir-title">存储位置</h3><p>翻译记忆数据库（tm.db）的存放目录。</p></div>
      </div>
      <div className="tm-dir-group">
        <div className="tm-dir-row">
          <span>当前位置</span>
          <span className="tm-dir-value">
            <span className="tm-dir-path" title={currentDir}>{currentDir || "读取中…"}</span>
            {isDefault && <span className="tm-dir-badge">默认</span>}
          </span>
        </div>
        <div className="tm-dir-row">
          <label htmlFor="tm-dir-input">新目录</label>
          <input
            id="tm-dir-input"
            type="text"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && input.trim()) void apply(input);
            }}
            placeholder="绝对路径，例如 D:\VanishTrans"
          />
        </div>
        <div className="tm-dir-row">
          <label htmlFor="tm-migrate">迁移数据</label>
          <ToggleSwitch id="tm-migrate" checked={migrate} onChange={setMigrate} disabled={busy} />
        </div>
      </div>
      <div className="tm-dir-actions">
        <button
          type="button"
          className="text-action tm-dir-apply"
          disabled={busy || !input.trim()}
          onClick={() => void apply(input)}
        >
          应用
        </button>
        <button
          type="button"
          className="text-action"
          disabled={busy || isDefault}
          onClick={() => void apply("")}
        >
          恢复默认
        </button>
        {saved && <span className="setting-hint">已保存，重启后生效</span>}
      </div>
      <p className="setting-hint">迁移会把现有 tm.db 复制到新目录且不覆盖已有文件；更改后重启应用生效。</p>
    </section>
  );
}

/** Translation memory tab: search state lives here so switching tabs resets nothing else. */
export default function TmTab() {
  const [search, setSearch] = useState("");
  return (
    <>
      <TmDirSection />
      <section className="settings-section" style={{ padding: 0, overflow: "hidden" }} aria-label="翻译记忆">
        <TmPanel searchQuery={search} onSearchChange={setSearch} />
      </section>
    </>
  );
}
