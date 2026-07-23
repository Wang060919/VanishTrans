import { describe, expect, it } from "vitest";
import { parseJson, rebuildJson } from "./fileParser";

describe("JSON translation paths", () => {
  it("keeps dot-delimited object keys distinct from nested properties", () => {
    const original = JSON.stringify({ "a.b": "flat", a: { b: "nested" } });
    const result = rebuildJson(original, new Map([
      ["/a.b", "flat translated"],
      ["/a/b", "nested translated"],
    ]));

    expect(JSON.parse(result)).toEqual({
      "a.b": "flat translated",
      a: { b: "nested translated" },
    });
  });

  it("escapes slash and tilde keys and indexes arrays without collisions", () => {
    const original = JSON.stringify({ "a/b": "slash", "a~b": "tilde", items: ["first"] });
    expect(parseJson(original)).toEqual([
      { path: "/a~1b", text: "slash" },
      { path: "/a~0b", text: "tilde" },
      { path: "/items/0", text: "first" },
    ]);

    const result = rebuildJson(original, new Map([
      ["/a~1b", "slash translated"],
      ["/a~0b", "tilde translated"],
      ["/items/0", ""],
    ]));
    expect(JSON.parse(result)).toEqual({ "a/b": "slash translated", "a~b": "tilde translated", items: [""] });
  });

  it("rebuilds a root JSON string", () => {
    const original = '"hello"';
    expect(parseJson(original)).toEqual([{ path: "", text: "hello" }]);
    expect(JSON.parse(rebuildJson(original, new Map([["", "你好"]])))).toBe("你好");
  });
});
