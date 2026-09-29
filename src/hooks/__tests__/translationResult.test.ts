import { act, renderHook } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationSession } from "../useTranslationSession";
import { useTranslation } from "../useTranslation";
import type { IslandResult, TranslationResult } from "../../lib/translationResult";

vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/tauriBridge", () => ({ cancelTranslation: vi.fn().mockResolvedValue(undefined) }));
const snapshot: TranslationResult = { source: "hello", text: "你好", direction: "en2zh" };
const events = () => vi.mocked(emit).mock.calls.map(([, payload]) => payload as { state: string; result?: TranslationResult });

describe("completed result snapshots", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps the translated source and direction even when the editor changes mid-request", () => {
    const { result } = renderHook(() => useTranslationSession());
    let id = 0;
    act(() => {
      id = result.current.begin("stream");
      result.current.setRequestSource(id, snapshot.source, snapshot.direction);
      result.current.setInputText("new draft");
      result.current.handleStreamDone({ requestId: id, fullText: snapshot.text });
      result.current.complete(id, "duplicate");
    });
    expect(events().filter((event) => event.state === "done")).toEqual([expect.objectContaining({ result: snapshot })]);
    expect(result.current.inputText).toBe("new draft");
  });
  it("does not broadcast superseded or cancelled results", () => {
    const { result } = renderHook(() => useTranslationSession());
    act(() => {
      const old = result.current.begin("text");
      result.current.setRequestSource(old, "old", "auto");
      const current = result.current.begin("text");
      result.current.setRequestSource(current, "current", "auto");
      result.current.setRequestSource(old, "late old source", "en2zh");
      result.current.complete(old, "late old result");
      result.current.cancel();
      result.current.complete(current, "cancelled result");
    });
    expect(events().every((event) => event.result === undefined)).toBe(true);
  });
  it("does not reuse a prior text snapshot for a structured file result", () => {
    const { result } = renderHook(() => useTranslationSession());
    act(() => {
      const text = result.current.begin("text");
      result.current.setRequestSource(text, "hello", "auto");
      result.current.complete(text, "你好");
      const file = result.current.begin("file");
      result.current.complete(file, "<translated markup>", "file complete");
    });
    expect(events().at(-1)).not.toHaveProperty("result");
  });
  it("publishes a validated native fallback only once", () => {
    const { result } = renderHook(() => useTranslationSession());
    act(() => {
      expect(result.current.applyExternalResult({ source: "native", text: "原生", requestSeq: 5 })).toBe(true);
      expect(result.current.applyExternalResult({ source: "old", text: "过期", requestSeq: 4 })).toBe(false);
    });
    expect(events()).toHaveLength(1);
    expect(events()[0].result).toEqual({ source: "native", text: "原生", direction: "auto" });
  });
  it("restores both texts and direction without translating or resetting on ordinary rerenders", () => {
    const selected: IslandResult = { ...snapshot, sourceId: "quick:A", requestId: 1, revision: 2 };
    const { result, rerender } = renderHook(() => useTranslation(selected));
    expect(result.current.inputText).toBe(snapshot.source);
    expect(result.current.outputText).toBe(snapshot.text);
    expect(result.current.direction).toBe(snapshot.direction);
    expect(result.current.loading).toBe(false);
    act(() => result.current.setInputText("edited"));
    rerender();
    expect(result.current.inputText).toBe("edited");
    expect(events().filter((event) => event.state === "done")).toHaveLength(1);
  });
});
