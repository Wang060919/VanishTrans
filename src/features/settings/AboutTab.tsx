import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-shell";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { ArrowUpRight, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import appIcon from "../../assets/brand/app-icon.svg";
import { logError } from "../../lib/logger";

const PROJECT_PAGE = "https://github.com/Wang060919/VanishTrans";

type UpdateState =
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "checkFailed" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number | null }
  | { kind: "installFailed"; update: Update }
  | { kind: "installed" };

function downloadPercent(received: number, total: number | null): number | null {
  if (!total) return null;
  return Math.min(100, Math.round((received / total) * 100));
}

// Settings tabs unmount/remount on every switch; update state lives at module
// level so a revisit reuses the last result instead of re-hitting GitHub, and
// a download still running in the background keeps its progress visible.
const UPDATE_CACHE_TTL_MS = 5 * 60 * 1000;
let updateInFlight = false;
let installInFlight = false;
let lastCheckedAt = 0;
let updateCache: UpdateState | null = null;
const updateListeners = new Set<(state: UpdateState | null) => void>();

function publishUpdate(next: UpdateState | null): void {
  updateCache = next;
  updateListeners.forEach((listener) => listener(next));
}

/** Test hook: tests render several mounts in one module registry. */
export function resetAboutUpdateCache(): void {
  updateInFlight = false;
  installInFlight = false;
  lastCheckedAt = 0;
  publishUpdate(null);
}

/** About tab: version info plus signed auto-updates via the updater plugin. */
export default function AboutTab() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(updateCache);

  // Live instances follow the shared cache so an in-flight check or download
  // started by a previous mount still updates the visible tab.
  useEffect(() => {
    const listener = (next: UpdateState | null) => setUpdate(next);
    updateListeners.add(listener);
    return () => { updateListeners.delete(listener); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await getVersion();
        if (!cancelled) setVersion(found);
      } catch (error) {
        logError("about", "读取应用版本失败", error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const checkForUpdates = useCallback(async (forced = false) => {
    // Skip re-checking on a mere tab revisit while a check is running or the
    // last result is still fresh; the button bypasses the cache.
    if (!forced && (updateInFlight
      || (updateCache !== null && Date.now() - lastCheckedAt < UPDATE_CACHE_TTL_MS))) {
      return;
    }
    updateInFlight = true;
    publishUpdate({ kind: "checking" });
    try {
      const found = await check();
      publishUpdate(found ? { kind: "available", update: found } : { kind: "none" });
      lastCheckedAt = Date.now();
    } catch (error) {
      logError("about", "检查更新失败", error);
      publishUpdate({ kind: "checkFailed" });
      lastCheckedAt = Date.now();
    } finally {
      updateInFlight = false;
    }
  }, []);

  // Auto-check once when the page opens; the button stays for manual retries.
  useEffect(() => { void checkForUpdates(); }, [checkForUpdates]);

  const installUpdate = useCallback(async (pending: Update) => {
    if (installInFlight) return;
    installInFlight = true;
    publishUpdate({ kind: "downloading", percent: null });
    let received = 0;
    let total: number | null = null;
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
        } else {
          received = total ?? received;
        }
        publishUpdate({ kind: "downloading", percent: downloadPercent(received, total) });
      });
      publishUpdate({ kind: "installed" });
    } catch (error) {
      logError("about", "下载或安装更新失败", error);
      publishUpdate({ kind: "installFailed", update: pending });
    } finally {
      installInFlight = false;
    }
  }, []);

  const openProject = useCallback(async () => {
    try {
      await open(PROJECT_PAGE);
    } catch (error) {
      logError("about", `打开链接失败: ${PROJECT_PAGE}`, error);
    }
  }, []);

  const busy = update?.kind === "checking" || update?.kind === "downloading";

  return (
    <section className="settings-section" aria-labelledby="about-settings-title">
      <div className="settings-section-heading">
        <Info size={17} aria-hidden="true" />
        <div><h3 id="about-settings-title">关于</h3><p>版本信息与自动更新。</p></div>
      </div>
      <div className="about-hero">
        <img className="about-icon" src={appIcon} alt="" />
        <div className="about-name">VanishTrans</div>
        <div className="about-version">版本 {version ?? "未知"}</div>
      </div>
      <div className="about-group">
        <div className="about-row">
          <span>检查更新</span>
          <button
            type="button"
            className="text-action"
            disabled={busy}
            onClick={() => void checkForUpdates(true)}
          >
            {update?.kind === "checking" ? "检查中…" : "检查"}
          </button>
        </div>
        <button type="button" className="about-row" onClick={() => void openProject()}>
          <span>项目主页</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
        <div className="about-row">
          <span>开源许可</span>
          <span className="about-value">MIT</span>
        </div>
      </div>
      {update?.kind === "none" && (
        <p className="about-status about-status--ok" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />当前已是最新版本
        </p>
      )}
      {update?.kind === "checkFailed" && (
        <p className="about-status about-status--error" role="status">
          <TriangleAlert size={14} aria-hidden="true" />检查失败，请稍后再试
        </p>
      )}
      {(update?.kind === "available" || update?.kind === "installFailed") && (
        <p className="about-status about-status--update" role="status">
          {update.kind === "installFailed" ? "下载或安装失败" : `发现新版本 v${update.update.version}`}
          <button
            type="button"
            className="text-action"
            onClick={() => void installUpdate(update.update)}
          >
            {update.kind === "installFailed" ? "重试" : "下载并安装"}
          </button>
        </p>
      )}
      {update?.kind === "downloading" && (
        <p className="about-status about-status--update" role="status">
          正在下载更新{update.percent === null ? "…" : ` ${update.percent}%`}
        </p>
      )}
      {update?.kind === "installed" && (
        <p className="about-status about-status--ok" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />更新已就绪
          <button type="button" className="text-action" onClick={() => void relaunch()}>
            重启生效
          </button>
        </p>
      )}
      <p className="setting-hint">新版本经签名校验后自动安装，重启应用后生效。</p>
    </section>
  );
}
