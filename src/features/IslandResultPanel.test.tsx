import { describe, expect, it } from "vitest";
import { directionLabelFor } from "./IslandResultPanel";

describe("directionLabelFor CJK detection", () => {
  it("mirrors the backend cjk_ratio: Hangul and PUA are not CJK", () => {
    expect(directionLabelFor("auto", "안녕하세요 오늘 날씨가 좋네요")).toBe("英语 → 简体中文");
    expect(directionLabelFor("auto", "你好世界，今天天气很好")).toBe("简体中文 → 英语");
    // CJK compatibility ideographs (U+F900–FAFF) still count as Han.
    const compat = String.fromCodePoint(0xf900, 0xf91e, 0xf930, 0xfa70, 0xfaff, 0xfa12);
    expect(directionLabelFor("auto", compat)).toBe("简体中文 → 英语");
  });

  it("keeps explicit directions regardless of source text", () => {
    expect(directionLabelFor("en2zh", "안녕하세요")).toBe("英语 → 简体中文");
    expect(directionLabelFor("zh2en", "hello")).toBe("简体中文 → 英语");
  });
});
