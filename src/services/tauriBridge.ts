import { invoke } from "@tauri-apps/api/core";
import type { ServiceProfile, TmEntry, TmStats, TranslationRecord } from "../types";

// Request/Response types
export interface CommandError {
  code: string;
  message: string;
}

export interface ApiConfigResponse {
  baseUrl: string;
  hasApiKey: boolean;
  model: string;
  glossary?: [string, string][];
  hotkeys?: [string, string][];
  profiles?: ServiceProfile[];
  freeTranslation?: boolean;
}

export type SetApiConfigRequest = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};

export type SetHotkeysRequest = { hotkeys: [string, string][] };
export type SetGlossaryRequest = { glossary: [string, string][] };
export type SetFreeTranslationRequest = { enabled: boolean };
export type SetLoggingEnabledRequest = { enabled: boolean };
export type LogFrontendMessageRequest = { level: string; message: string };
export type WriteClipboardSafeRequest = { text: string };
export type CleanupClipboardTextRequest = { text: string };
export type TranslateRequest = { text: string; sourceLang: string; targetLang: string };
export type TranslateWithDirectionRequest = { text: string; direction: string; forceRefresh?: boolean };
export type TranslateStreamRequest = { text: string; direction: string; requestId: number; forceRefresh?: boolean };
export type TranslateBatchRequest = { segments: string[]; direction: string };
export type GetHistoryRequest = { query?: string };
export type DeleteHistoryRecordRequest = { id: number };
export type TmSearchRequest = { query?: string };
export type TmDeleteRequest = { id: number };
export type TmExportRequest = { path: string };
export type TmImportRequest = { path: string };
export type TmImportContentRequest = { content: string };
export interface ScreenshotPayload {
  dataUri: string;
  imageWidth: number;
  imageHeight: number;
  monitorX: number;
  monitorY: number;
  monitorWidth: number;
  monitorHeight: number;
  scaleFactor: number;
  smartRegions?: Array<{ x: number; y: number; width: number; height: number; }>;
}
export type RunOcrOnCropRequest = { x: number; y: number; w: number; h: number };
export interface OcrOutput { text: string; }
export type FinishOcrRequest = { text: string };
export type SetBallWindowBoundsRequest = { x: number; y: number; width: number; height: number };
export type ShowMainWithTextRequest = { text: string };
export type SaveBallPositionRequest = { x: number; y: number; reposition?: boolean };
export type BallPositionResponse = [number, number];
export type SaveServiceProfileRequest = { name: string; baseUrl: string; model: string };
export type DeleteServiceProfileRequest = { name: string };
export type ApplyServiceProfileRequest = { name: string };
export type StartupWarningsResponse = string[];
export type SetMaxRecordsRequest = { maxRecords: number };

export type CommandName =
  | "frontend_ready"
  | "get_startup_warnings"
  | "quick_frontend_ready"
  | "log_frontend_message"
  | "set_logging_enabled"
  | "get_logging_enabled"
  | "read_clipboard_safe"
  | "write_clipboard_safe"
  | "cleanup_clipboard_text"
  | "get_api_config"
  | "set_api_config"
  | "set_hotkeys"
  | "set_glossary"
  | "set_free_translation"
  | "set_max_records"
  | "list_service_profiles"
  | "save_service_profile"
  | "delete_service_profile"
  | "apply_service_profile"
  | "test_connection"
  | "translate"
  | "translate_with_direction"
  | "translate_stream"
  | "translate_batch"
  | "cancel_translation"
  | "get_history"
  | "delete_history_record"
  | "clear_history"
  | "tm_search"
  | "tm_delete"
  | "tm_clear"
  | "tm_stats"
  | "tm_export"
  | "tm_import"
  | "tm_import_content"
  | "get_screenshot_payload"
  | "run_ocr_on_crop"
  | "cancel_screenshot"
  | "finish_ocr"
  | "hide_window"
  | "toggle_pin"
  | "get_pin_state"
  | "set_ball_window_bounds"
  | "show_main_window"
  | "hide_quick_window"
  | "show_main_with_text"
  | "translate_clipboard_from_ball"
  | "start_screenshot_from_ball"
  | "toggle_ball_show_main"
  | "toggle_ball"
  | "save_ball_position"
  | "get_ball_position";

export function isCommandError(error: unknown): error is CommandError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<CommandError>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

export function normalizeCommandError(error: unknown): CommandError {
  if (isCommandError(error)) return error;
  if (error instanceof Error) return { code: "UNKNOWN", message: error.message };
  if (typeof error === "string") return { code: "UNKNOWN", message: error };
  return { code: "UNKNOWN", message: "Tauri 命令执行失败" };
}

async function invokeCommand<T>(command: CommandName, args?: unknown): Promise<T> {
  try {
    // Only pass args if it's defined to avoid mock matching issues in tests
    return args !== undefined 
      ? await invoke<T>(command, args as Record<string, unknown>)
      : await invoke<T>(command);
  } catch (error: unknown) {
    throw normalizeCommandError(error);
  }
}

interface ServiceProfileWire {
  name: string;
  base_url: string;
  model: string;
}

interface ApiConfigWire extends Omit<ApiConfigResponse, "profiles"> {
  profiles: ServiceProfileWire[];
}

function toServiceProfile(profile: ServiceProfileWire): ServiceProfile {
  return { name: profile.name, baseUrl: profile.base_url, model: profile.model };
}

function toServiceProfiles(profiles: ServiceProfileWire[]): ServiceProfile[] {
  return profiles.map(toServiceProfile);
}

export async function frontendReady(): Promise<void> {
  return invokeCommand<void>("frontend_ready");
}

export async function getStartupWarnings(): Promise<StartupWarningsResponse> {
  return invokeCommand<StartupWarningsResponse>("get_startup_warnings");
}


export async function quickFrontendReady(): Promise<void> {
  return invokeCommand<void>("quick_frontend_ready");
}

export async function logFrontendMessage(request: LogFrontendMessageRequest): Promise<void> {
  return invokeCommand<void>("log_frontend_message", request);
}

export async function setLoggingEnabled(request: SetLoggingEnabledRequest): Promise<void> {
  return invokeCommand<void>("set_logging_enabled", request);
}

export async function getLoggingEnabled(): Promise<boolean> {
  return invokeCommand<boolean>("get_logging_enabled");
}

export async function readClipboardSafe(): Promise<string> {
  return invokeCommand<string>("read_clipboard_safe");
}

export async function writeClipboardSafe(request: WriteClipboardSafeRequest): Promise<void> {
  return invokeCommand<void>("write_clipboard_safe", request);
}

export async function cleanupClipboardText(request: CleanupClipboardTextRequest): Promise<string> {
  return invokeCommand<string>("cleanup_clipboard_text", request);
}

export async function getApiConfig(): Promise<ApiConfigResponse> {
  const config = await invokeCommand<ApiConfigWire>("get_api_config");
  return { ...config, profiles: toServiceProfiles(config.profiles ?? []) };
}

export async function setApiConfig(request: SetApiConfigRequest): Promise<void> {
  return invokeCommand<void>("set_api_config", request);
}

export async function setHotkeys(request: SetHotkeysRequest): Promise<void> {
  return invokeCommand<void>("set_hotkeys", request);
}

export async function setGlossary(request: SetGlossaryRequest): Promise<void> {
  return invokeCommand<void>("set_glossary", request);
}

export async function setFreeTranslation(request: SetFreeTranslationRequest): Promise<void> {
  return invokeCommand<void>("set_free_translation", request);
}

export async function setMaxRecords(request: SetMaxRecordsRequest): Promise<void> {
  return invokeCommand<void>("set_max_records", request);
}

export async function listServiceProfiles(): Promise<ServiceProfile[]> {
  const profiles = await invokeCommand<ServiceProfileWire[]>("list_service_profiles");
  return toServiceProfiles(profiles);
}

export async function saveServiceProfile(request: SaveServiceProfileRequest): Promise<ServiceProfile[]> {
  const profiles = await invokeCommand<ServiceProfileWire[]>("save_service_profile", request);
  return toServiceProfiles(profiles);
}

export async function deleteServiceProfile(request: DeleteServiceProfileRequest): Promise<ServiceProfile[]> {
  const profiles = await invokeCommand<ServiceProfileWire[]>("delete_service_profile", request);
  return toServiceProfiles(profiles);
}

export async function applyServiceProfile(request: ApplyServiceProfileRequest): Promise<ServiceProfile> {
  const profile = await invokeCommand<ServiceProfileWire>("apply_service_profile", request);
  return toServiceProfile(profile);
}

export async function testConnection(request: SetApiConfigRequest): Promise<string> {
  return invokeCommand<string>("test_connection", request);
}

export async function translate(request: TranslateRequest): Promise<string> {
  return invokeCommand<string>("translate", request);
}

export async function translateWithDirection(request: TranslateWithDirectionRequest): Promise<string> {
  return invokeCommand<string>("translate_with_direction", request);
}

export async function translateStream(request: TranslateStreamRequest): Promise<string> {
  return invokeCommand<string>("translate_stream", { request });
}

export async function translateBatch(request: TranslateBatchRequest): Promise<string[]> {
  return invokeCommand<string[]>("translate_batch", request);
}

export async function cancelTranslation(): Promise<void> {
  return invokeCommand<void>("cancel_translation");
}

export async function getHistory(request: GetHistoryRequest = {}): Promise<TranslationRecord[]> {
  return invokeCommand<TranslationRecord[]>("get_history", { query: request.query ?? null });
}

export async function deleteHistoryRecord(request: DeleteHistoryRecordRequest): Promise<void> {
  return invokeCommand<void>("delete_history_record", request);
}

export async function clearHistory(): Promise<void> {
  return invokeCommand<void>("clear_history");
}

export async function searchTm(request: TmSearchRequest = {}): Promise<TmEntry[]> {
  return invokeCommand<TmEntry[]>("tm_search", { query: request.query ?? null });
}

export async function deleteTmEntry(request: TmDeleteRequest): Promise<void> {
  return invokeCommand<void>("tm_delete", request);
}

export async function clearTm(): Promise<void> {
  return invokeCommand<void>("tm_clear");
}

export async function getTmStats(): Promise<TmStats> {
  return invokeCommand<TmStats>("tm_stats");
}

export async function exportTm(request: TmExportRequest): Promise<number> {
  return invokeCommand<number>("tm_export", request);
}

export async function importTm(request: TmImportRequest): Promise<number> {
  return invokeCommand<number>("tm_import", request);
}

export async function importTmContent(request: TmImportContentRequest): Promise<number> {
  return invokeCommand<number>("tm_import_content", request);
}

export async function getScreenshotPayload(): Promise<ScreenshotPayload> {
  return invokeCommand<ScreenshotPayload>("get_screenshot_payload");
}

export async function runOcrOnCrop(request: RunOcrOnCropRequest): Promise<OcrOutput> {
  return invokeCommand<OcrOutput>("run_ocr_on_crop", request);
}

export async function cancelScreenshot(): Promise<void> {
  return invokeCommand<void>("cancel_screenshot");
}

export async function finishOcr(request: FinishOcrRequest): Promise<void> {
  return invokeCommand<void>("finish_ocr", request);
}

export async function hideWindow(): Promise<void> {
  return invokeCommand<void>("hide_window");
}

export async function togglePin(): Promise<boolean> {
  return invokeCommand<boolean>("toggle_pin");
}

export async function getPinState(): Promise<boolean> {
  return invokeCommand<boolean>("get_pin_state");
}

export async function setBallWindowBounds(request: SetBallWindowBoundsRequest): Promise<void> {
  return invokeCommand<void>("set_ball_window_bounds", request);
}

export async function showMainWindow(): Promise<void> {
  return invokeCommand<void>("show_main_window");
}

export async function hideQuickWindow(): Promise<void> {
  return invokeCommand<void>("hide_quick_window");
}

export async function showMainWithText(request: ShowMainWithTextRequest): Promise<void> {
  return invokeCommand<void>("show_main_with_text", request);
}

export async function translateClipboardFromBall(): Promise<void> {
  return invokeCommand<void>("translate_clipboard_from_ball");
}

export async function startScreenshotFromBall(): Promise<void> {
  return invokeCommand<void>("start_screenshot_from_ball");
}

export async function toggleBallShowMain(): Promise<void> {
  return invokeCommand<void>("toggle_ball_show_main");
}

export async function toggleBall(): Promise<void> {
  return invokeCommand<void>("toggle_ball");
}

export async function saveBallPosition(request: SaveBallPositionRequest): Promise<BallPositionResponse> {
  return invokeCommand<BallPositionResponse>("save_ball_position", request);
}

export async function getBallPosition(): Promise<BallPositionResponse> {
  return invokeCommand<BallPositionResponse>("get_ball_position");
}

