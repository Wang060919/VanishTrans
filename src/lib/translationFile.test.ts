import { describe, expect, it } from "vitest";
import { MAX_TRANSLATION_CHARS } from "./fileParser";
import { prepareTranslationFile } from "./translationFile";

const srtBlock = (index: number, text: string) =>
  `${index}\n00:00:0${index},000 --> 00:00:0${index},500\n${text}`;

describe("prepareTranslationFile", () => {
  it("rebuilds an SRT file with translated segments in place", () => {
    const srt = `${srtBlock(1, "hello")}\n\n${srtBlock(2, "")}`;
    const { segments, rebuild } = prepareTranslationFile("a.srt", srt);
    expect(segments).toEqual(["hello"]);
    expect(rebuild(["你好"])).toBe(
      "1\n00:00:01,000 --> 00:00:01,500\n你好\n\n2\n00:00:02,000 --> 00:00:02,500\n",
    );
  });

  it("throws for an SRT whose blocks carry no translatable text", () => {
    const srt = `${srtBlock(1, "   ")}\n\n${srtBlock(2, "")}`;
    expect(() => prepareTranslationFile("blank.srt", srt))
      .toThrow("文件中没有可翻译的文本");
  });

  it("throws for JSON without translatable strings", () => {
    expect(() => prepareTranslationFile("a.json", '{"a": "  ", "b": 1}'))
      .toThrow("JSON 中没有可翻译的文本");
  });

  it("rejects a file that only the worst-case marker would push over the limit", () => {
    // 5,000 + 4,972 = 9,972 segment chars pass with the 28-char default marker
    // (\n\n===SEGMENT_BREAK===\n\n) but exceed 10,000 under the 34-char
    // ===VANISHTRANS_SEGMENT_1000=== marker the backend can substitute.
    const srt = `${srtBlock(1, "a".repeat(5000))}\n\n${srtBlock(2, "b".repeat(4972))}`;
    expect(() => prepareTranslationFile("big.srt", srt)).toThrow("文件内容过长");
  });

  it("accepts a file that stays under the limit even with the worst-case marker", () => {
    const srt = `${srtBlock(1, "a".repeat(5000))}\n\n${srtBlock(2, "b".repeat(4000))}`;
    const { segments } = prepareTranslationFile("ok.srt", srt);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(5000);
    expect(segments[0].length + segments[1].length).toBeLessThan(MAX_TRANSLATION_CHARS);
  });
});
