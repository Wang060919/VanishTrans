import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { ApiConfigResponse, CommandName } from "../src/services/tauriBridge";
import { HISTORY_RECORDS, SAMPLE_SOURCE, SAMPLE_TEXT, TM_ENTRIES } from "./fixtures";
import { SCREENSHOT_PAYLOAD } from "./screenshotFixture";

type WireProfile = { name: string; base_url: string; model: string };
let config: Omit<ApiConfigResponse, "profiles"> & { profiles: WireProfile[] };
let records = structuredClone(HISTORY_RECORDS);
let entries = structuredClone(TM_ENTRIES);
let pinned = false;
let logging = false;
let clipboard = SAMPLE_SOURCE;
let tmDir = { path: "Ladle/translation-memory", is_default: true };
let scenario = "";
let errorSeeded = false;
let generation = 0;
let quickSequence = 0;

export function resetPreviewBackend(windowLabel = "main", nextScenario = "") {
  generation++;
  scenario = nextScenario;
  errorSeeded = false;
  mockWindows(windowLabel);
  config = {
    baseUrl: "https://api.example.com/v1", model: "preview-model", hasApiKey: true,
    freeTranslation: false,
    glossary: [["translation memory", "翻译记忆"], ["workspace", "工作台"]],
    hotkeys: [["translate", "Alt+Q"], ["replace", "Alt+R"], ["screenshot", "Alt+W"]],
    profiles: [{ name: "预览服务", base_url: "https://api.example.com/v1", model: "preview-model" }],
  };
  records = structuredClone(HISTORY_RECORDS);
  entries = structuredClone(TM_ENTRIES);
  pinned = false;
  logging = false;
  clipboard = SAMPLE_SOURCE;
  tmDir = { path: "Ladle/translation-memory", is_default: true };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function previewError(message: string): never { throw { code: "PREVIEW_ONLY", message }; }
const noOpCommands = new Set<CommandName>([
  "quick_frontend_ready", "set_shortcuts_suspended", "set_max_records",
  "log_frontend_message", "hide_window", "hide_quick_window", "show_main_window",
  "show_main_with_text", "translate_clipboard_from_ball", "start_screenshot_from_ball",
  "toggle_ball_show_main", "toggle_ball", "cancel_screenshot", "finish_ocr",
]);

// Install before story imports, including QuickTranslateWindow's module handshake.
resetPreviewBackend();
mockIPC(async (command, rawArgs) => {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const text = String(args.text ?? "");
  const query = String(args.query ?? "").toLowerCase();
  const matches = (source: string, target: string) => `${source} ${target}`.toLowerCase().includes(query);
  switch (command) {
    case "frontend_ready":
      if (args.ready && scenario === "translation-error" && !errorSeeded) {
        errorSeeded = true;
        await emit("shortcut-translate", SAMPLE_SOURCE);
      }
      return;
    case "get_api_config": return structuredClone(config);
    case "get_startup_warnings": return scenario === "startup-warning" ? ["预览提示：翻译服务暂时不可用。"] : [];
    case "get_logging_enabled": return logging;
    case "set_logging_enabled": logging = Boolean(args.enabled); return;
    case "set_api_config":
      config.baseUrl = String(args.baseUrl); config.model = String(args.model);
      if (args.apiKey !== undefined) config.hasApiKey = Boolean(args.apiKey);
      return;
    case "set_glossary": config.glossary = args.glossary as [string, string][]; return;
    case "set_hotkeys": config.hotkeys = args.hotkeys as [string, string][]; return;
    case "set_free_translation": config.freeTranslation = Boolean(args.enabled); return;
    case "list_service_profiles": return structuredClone(config.profiles);
    case "save_service_profile": {
      const profile = { name: String(args.name), base_url: String(args.baseUrl), model: String(args.model) };
      config.profiles = [...config.profiles.filter((item) => item.name !== profile.name), profile];
      return structuredClone(config.profiles);
    }
    case "delete_service_profile":
      config.profiles = config.profiles.filter((item) => item.name !== args.name); return structuredClone(config.profiles);
    case "apply_service_profile": {
      const profile = config.profiles.find((item) => item.name === args.name);
      if (!profile) return previewError("找不到预览服务。");
      config.baseUrl = profile.base_url; config.model = profile.model;
      return structuredClone(profile);
    }
    case "test_connection": await delay(200); return "预览连接成功（本地模拟）";
    case "read_clipboard_safe": return clipboard;
    case "write_clipboard_safe": clipboard = text; return;
    case "cleanup_clipboard_text": return text.trim();
    case "translate_with_direction": await delay(300); return SAMPLE_TEXT;
    case "translate_batch": {
      const segments = args.segments as string[];
      const currentGeneration = generation;
      const translated: string[] = [];
      for (let index = 0; index < segments.length; index++) {
        await delay(600);
        if (currentGeneration !== generation) throw { code: "CANCELLED", message: "预览翻译已取消。" };
        translated.push(SAMPLE_TEXT);
        await emit("file-progress", { completed: index + 1, total: segments.length });
      }
      return translated;
    }
    case "translate_stream": {
      const request = args.request as { requestId: number };
      const currentGeneration = generation;
      if (scenario === "translation-error") {
        scenario = "";
        return previewError("请求失败，请检查预览模型配置。");
      }
      for (const chunk of SAMPLE_TEXT.split(/(?<=，|。)/)) {
        await delay(250);
        if (currentGeneration !== generation) return "";
        await emit("translate-stream-chunk", { requestId: request.requestId, chunk });
      }
      await emit("translate-stream-done", { requestId: request.requestId, fullText: SAMPLE_TEXT });
      return SAMPLE_TEXT;
    }
    case "cancel_translation": generation++; return;
    case "reserve_quick_request": return ++quickSequence;
    case "reveal_quick_result": return true;
    case "get_pin_state": return pinned;
    case "toggle_pin": pinned = !pinned; return pinned;
    case "get_history": return structuredClone(records.filter((item) => matches(item.original, item.translated)));
    case "delete_history_record": records = records.filter((item) => item.id !== args.id); return;
    case "clear_history": records = []; return;
    case "tm_search": return structuredClone(entries.filter((item) => matches(item.source, item.target)));
    case "tm_stats": return { total_entries: entries.length, total_hits: entries.reduce((sum, item) => sum + item.hit_count, 0) };
    case "tm_delete": entries = entries.filter((item) => item.id !== args.id); return;
    case "tm_clear": entries = []; return;
    case "tm_export": case "tm_import": case "tm_import_content": return previewError("Ladle 预览不执行文件导入导出。");
    case "get_tm_dir": return { ...tmDir };
    case "set_tm_dir":
      tmDir = args.path
        ? { path: String(args.path), is_default: false }
        : { path: "Ladle/translation-memory", is_default: true };
      return;
    case "get_screenshot_payload":
      if (scenario === "screenshot-error") return previewError("模拟截图加载失败。");
      return SCREENSHOT_PAYLOAD;
    case "run_ocr_on_crop": await delay(600); return { text: SAMPLE_SOURCE };
    case "start_window_drag": return false;
    case "set_ball_window_bounds": return true;
    case "get_ball_position": case "save_ball_position": return [100, 100];
    case "get_foreground_window_info": return "Ladle 预览";
    case "plugin:app|version": return "0.0.0-preview";
    case "plugin:updater|check": return null;
    case "plugin:path|resolve_directory": return "Ladle/";
    case "plugin:shell|open": case "plugin:process|restart":
    case "plugin:window|minimize": case "plugin:window|toggle_maximize":
    case "plugin:window|hide": case "plugin:window|set_size": case "plugin:window|start_dragging": return;
    default:
      if (noOpCommands.has(command as CommandName)) return;
      return previewError(`尚未支持的 Ladle 模拟命令：${command}`);
  }
}, { shouldMockEvents: true });

// Tauri 2.12 sends eventId on unlisten; its mock still reads id.
const previewWindow = window as unknown as Window & {
  __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
};
const invokeMock = previewWindow.__TAURI_INTERNALS__.invoke;
previewWindow.__TAURI_INTERNALS__.invoke = (command, args) => invokeMock(command,
  command === "plugin:event|unlisten" ? { ...args, id: args?.eventId } : args);
