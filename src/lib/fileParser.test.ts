import { describe, it, expect } from "vitest";
import {
  parseSrt,
  rebuildSrt,
  parseJson,
  rebuildJson,
  detectFileType,
  type SrtBlock,
} from "./fileParser";

// ══════════════════════════════════════════════════════════════
// SRT Parser Tests
// ══════════════════════════════════════════════════════════════

describe("parseSrt", () => {
  it("should parse valid SRT content", () => {
    const input = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,500 --> 00:00:07,000
This is a subtitle`;

    const result = parseSrt(input);

    expect(result).toEqual([
      {
        index: 1,
        timecode: "00:00:01,000 --> 00:00:03,000",
        text: "Hello world",
      },
      {
        index: 2,
        timecode: "00:00:04,500 --> 00:00:07,000",
        text: "This is a subtitle",
      },
    ]);
  });

  it("should handle multi-line subtitle text", () => {
    const input = `1
00:00:01,000 --> 00:00:03,000
Line one
Line two
Line three`;

    const result = parseSrt(input);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Line one\nLine two\nLine three");
  });

  it("should normalize line endings (CRLF and CR)", () => {
    const crlfInput = "1\r\n00:00:01,000 --> 00:00:03,000\r\nText\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nMore";
    const crInput = "1\r00:00:01,000 --> 00:00:03,000\rText\r\r2\r00:00:04,000 --> 00:00:05,000\rMore";

    const crlfResult = parseSrt(crlfInput);
    const crResult = parseSrt(crInput);

    expect(crlfResult).toHaveLength(2);
    expect(crResult).toHaveLength(2);
    expect(crlfResult[0].text).toBe("Text");
    expect(crResult[0].text).toBe("Text");
  });

  it("should skip blocks without valid index", () => {
    const input = `invalid
00:00:01,000 --> 00:00:03,000
Text

2
00:00:04,000 --> 00:00:05,000
Valid`;

    const result = parseSrt(input);

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(2);
  });

  it("should skip blocks without timecode arrow", () => {
    const input = `1
00:00:01,000
Text without arrow

2
00:00:04,000 --> 00:00:05,000
Valid`;

    const result = parseSrt(input);

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(2);
  });

  it("should skip blocks with empty text", () => {
    const input = `1
00:00:01,000 --> 00:00:03,000


2
00:00:04,000 --> 00:00:05,000
Valid text`;

    const result = parseSrt(input);

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(2);
  });

  it("should handle empty input", () => {
    expect(parseSrt("")).toEqual([]);
    expect(parseSrt("   ")).toEqual([]);
    expect(parseSrt("\n\n\n")).toEqual([]);
  });

  it("should handle single block", () => {
    const input = `1
00:00:01,000 --> 00:00:03,000
Single subtitle`;

    const result = parseSrt(input);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Single subtitle");
  });

  it("should handle extra blank lines between blocks", () => {
    const input = `1
00:00:01,000 --> 00:00:03,000
First



2
00:00:04,000 --> 00:00:05,000
Second`;

    const result = parseSrt(input);

    expect(result).toHaveLength(2);
  });
});

describe("rebuildSrt", () => {
  it("should rebuild SRT from blocks", () => {
    const blocks: SrtBlock[] = [
      {
        index: 1,
        timecode: "00:00:01,000 --> 00:00:03,000",
        text: "Hello",
      },
      {
        index: 2,
        timecode: "00:00:04,000 --> 00:00:05,000",
        text: "World",
      },
    ];

    const result = rebuildSrt(blocks);

    expect(result).toBe(
      `1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:05,000\nWorld`
    );
  });

  it("should preserve multi-line text", () => {
    const blocks: SrtBlock[] = [
      {
        index: 1,
        timecode: "00:00:01,000 --> 00:00:03,000",
        text: "Line one\nLine two",
      },
    ];

    const result = rebuildSrt(blocks);

    expect(result).toContain("Line one\nLine two");
  });

  it("should handle empty blocks array", () => {
    expect(rebuildSrt([])).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════
// JSON Parser Tests
// ══════════════════════════════════════════════════════════════

describe("parseJson", () => {
  it("should parse flat JSON object", () => {
    const input = JSON.stringify({
      title: "Hello",
      description: "World",
    });

    const result = parseJson(input);

    expect(result).toEqual([
      { path: "/title", text: "Hello" },
      { path: "/description", text: "World" },
    ]);
  });

  it("should parse nested JSON object", () => {
    const input = JSON.stringify({
      user: {
        name: "Alice",
        bio: "Developer",
      },
    });

    const result = parseJson(input);

    expect(result).toEqual([
      { path: "/user/name", text: "Alice" },
      { path: "/user/bio", text: "Developer" },
    ]);
  });

  it("should parse JSON array", () => {
    const input = JSON.stringify({
      items: ["First", "Second", "Third"],
    });

    const result = parseJson(input);

    expect(result).toEqual([
      { path: "/items/0", text: "First" },
      { path: "/items/1", text: "Second" },
      { path: "/items/2", text: "Third" },
    ]);
  });

  it("should skip non-string values", () => {
    const input = JSON.stringify({
      text: "Keep this",
      number: 42,
      boolean: true,
      null: null,
      empty: "",
      whitespace: "   ",
    });

    const result = parseJson(input);

    expect(result).toEqual([{ path: "/text", text: "Keep this" }]);
  });

  it("should escape special JSON Pointer characters", () => {
    const input = JSON.stringify({
      "key/with/slash": "Value 1",
      "key~with~tilde": "Value 2",
    });

    const result = parseJson(input);

    expect(result).toEqual([
      { path: "/key~1with~1slash", text: "Value 1" },
      { path: "/key~0with~0tilde", text: "Value 2" },
    ]);
  });

  it("should handle root-level string", () => {
    const input = JSON.stringify("Just a string");

    const result = parseJson(input);

    expect(result).toEqual([{ path: "", text: "Just a string" }]);
  });

  it("should handle deeply nested structure", () => {
    const input = JSON.stringify({
      level1: {
        level2: {
          level3: {
            text: "Deep value",
          },
        },
      },
    });

    const result = parseJson(input);

    expect(result).toEqual([
      { path: "/level1/level2/level3/text", text: "Deep value" },
    ]);
  });

  it("should throw on invalid JSON", () => {
    expect(() => parseJson("{invalid json}")).toThrow(/Invalid JSON/);
    expect(() => parseJson("not json at all")).toThrow(/Invalid JSON/);
    expect(() => parseJson("")).toThrow(/Invalid JSON/);
  });

  it("should handle empty object", () => {
    expect(parseJson("{}")).toEqual([]);
  });

  it("should handle empty array", () => {
    expect(parseJson("[]")).toEqual([]);
  });

  it("should handle mixed nested arrays and objects", () => {
    const input = JSON.stringify({
      users: [
        { name: "Alice", role: "Admin" },
        { name: "Bob", role: "User" },
      ],
    });

    const result = parseJson(input);

    expect(result).toEqual([
      { path: "/users/0/name", text: "Alice" },
      { path: "/users/0/role", text: "Admin" },
      { path: "/users/1/name", text: "Bob" },
      { path: "/users/1/role", text: "User" },
    ]);
  });
});

describe("rebuildJson", () => {
  it("should rebuild JSON with translations", () => {
    const original = JSON.stringify({
      title: "Original Title",
      description: "Original Description",
    });

    const translations = new Map([
      ["/title", "Translated Title"],
      ["/description", "Translated Description"],
    ]);

    const result = rebuildJson(original, translations);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      title: "Translated Title",
      description: "Translated Description",
    });
  });

  it("should preserve untranslated fields", () => {
    const original = JSON.stringify({
      translated: "Original",
      untranslated: "Keep this",
    });

    const translations = new Map([["/translated", "Changed"]]);

    const result = rebuildJson(original, translations);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      translated: "Changed",
      untranslated: "Keep this",
    });
  });

  it("should handle nested translations", () => {
    const original = JSON.stringify({
      user: {
        name: "Original Name",
        bio: "Original Bio",
      },
    });

    const translations = new Map([
      ["/user/name", "Translated Name"],
      ["/user/bio", "Translated Bio"],
    ]);

    const result = rebuildJson(original, translations);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      user: {
        name: "Translated Name",
        bio: "Translated Bio",
      },
    });
  });

  it("should handle array translations", () => {
    const original = JSON.stringify({
      items: ["First", "Second"],
    });

    const translations = new Map([
      ["/items/0", "Uno"],
      ["/items/1", "Dos"],
    ]);

    const result = rebuildJson(original, translations);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      items: ["Uno", "Dos"],
    });
  });

  it("should handle root-level string translation", () => {
    const original = JSON.stringify("Original");
    const translations = new Map([["", "Translated"]]);

    const result = rebuildJson(original, translations);

    expect(JSON.parse(result)).toBe("Translated");
  });

  it("should throw on invalid original JSON", () => {
    const translations = new Map();

    expect(() => rebuildJson("{invalid}", translations)).toThrow(/Invalid JSON/);
  });

  it("should preserve non-string values", () => {
    const original = JSON.stringify({
      text: "Original",
      number: 42,
      boolean: true,
      null: null,
    });

    const translations = new Map([["/text", "Translated"]]);

    const result = rebuildJson(original, translations);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      text: "Translated",
      number: 42,
      boolean: true,
      null: null,
    });
  });

  it("should format output with 2-space indentation", () => {
    const original = JSON.stringify({ key: "value" });
    const translations = new Map();

    const result = rebuildJson(original, translations);

    expect(result).toContain('  "key": "value"');
  });
});

// ══════════════════════════════════════════════════════════════
// File Type Detection Tests
// ══════════════════════════════════════════════════════════════

describe("detectFileType", () => {
  it("should detect .txt files", () => {
    expect(detectFileType("document.txt")).toBe("txt");
    expect(detectFileType("file.TXT")).toBe("txt");
    expect(detectFileType("path/to/readme.txt")).toBe("txt");
  });

  it("should detect .srt files", () => {
    expect(detectFileType("subtitle.srt")).toBe("srt");
    expect(detectFileType("movie.SRT")).toBe("srt");
    expect(detectFileType("folder/video.srt")).toBe("srt");
  });

  it("should detect .json files", () => {
    expect(detectFileType("data.json")).toBe("json");
    expect(detectFileType("config.JSON")).toBe("json");
    expect(detectFileType("api/response.json")).toBe("json");
  });

  it("should return unknown for unsupported extensions", () => {
    expect(detectFileType("image.png")).toBe("unknown");
    expect(detectFileType("script.js")).toBe("unknown");
    expect(detectFileType("style.css")).toBe("unknown");
  });

  it("should return unknown for files without extension", () => {
    expect(detectFileType("filename")).toBe("unknown");
    expect(detectFileType("README")).toBe("unknown");
  });

  it("should handle multiple dots in filename", () => {
    expect(detectFileType("file.backup.txt")).toBe("txt");
    expect(detectFileType("data.v2.json")).toBe("json");
  });

  it("should be case-insensitive", () => {
    expect(detectFileType("FILE.TxT")).toBe("txt");
    expect(detectFileType("DATA.JsOn")).toBe("json");
    expect(detectFileType("SUB.SrT")).toBe("srt");
  });
});

// ══════════════════════════════════════════════════════════════
// Integration Tests
// ══════════════════════════════════════════════════════════════

describe("SRT round-trip", () => {
  it("should preserve content through parse and rebuild", () => {
    const original = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,500 --> 00:00:07,000
Goodbye world`;

    const blocks = parseSrt(original);
    const rebuilt = rebuildSrt(blocks);
    const reparsed = parseSrt(rebuilt);

    expect(reparsed).toEqual(blocks);
  });

  it("should handle translation workflow", () => {
    const original = `1
00:00:01,000 --> 00:00:03,000
Hello

2
00:00:04,000 --> 00:00:05,000
World`;

    const blocks = parseSrt(original);

    // Simulate translation
    const translated = blocks.map((block) => ({
      ...block,
      text: block.text === "Hello" ? "Hola" : "Mundo",
    }));

    const result = rebuildSrt(translated);

    expect(result).toContain("Hola");
    expect(result).toContain("Mundo");
  });
});

describe("JSON round-trip", () => {
  it("should preserve structure through parse and rebuild", () => {
    const original = {
      title: "Original",
      nested: {
        key: "Value",
      },
      items: ["A", "B"],
    };

    const serialized = JSON.stringify(original, null, 2);
    const segments = parseJson(serialized);

    // Create identity translations
    const translations = new Map(segments.map((s) => [s.path, s.text]));
    const rebuilt = rebuildJson(serialized, translations);
    const parsed = JSON.parse(rebuilt);

    expect(parsed).toEqual(original);
  });

  it("should handle translation workflow", () => {
    const original = JSON.stringify({
      greeting: "Hello",
      farewell: "Goodbye",
    });

    // Parse and prepare translations
    const translations = new Map([
      ["/greeting", "Hola"],
      ["/farewell", "Adiós"],
    ]);

    const result = rebuildJson(original, translations);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      greeting: "Hola",
      farewell: "Adiós",
    });
  });
});
