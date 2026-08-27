import { describe, it, expect } from "vitest";
import {
  countChars,
  formatNumber,
  isErrorMessage,
  stripErrorMarker,
  hasContent,
  truncateText,
  isWithinLimit,
} from "./textUtils";

describe("textUtils", () => {
  describe("countChars", () => {
    it("should count ASCII characters correctly", () => {
      expect(countChars("hello")).toBe(5);
    });

    it("should count Unicode characters correctly", () => {
      expect(countChars("你好世界")).toBe(4);
      expect(countChars("👋🌍")).toBe(2);
    });

    it("should handle empty strings", () => {
      expect(countChars("")).toBe(0);
    });
  });

  describe("formatNumber", () => {
    it("should format numbers with locale separators", () => {
      const result = formatNumber(1000);
      // Different locales may format differently, just verify it's a string
      expect(typeof result).toBe("string");
      expect(result).toContain("000");
    });
  });

  describe("isErrorMessage", () => {
    it("should detect error messages", () => {
      expect(isErrorMessage("❌ 翻译失败")).toBe(true);
    });

    it("should return false for normal text", () => {
      expect(isErrorMessage("翻译成功")).toBe(false);
      expect(isErrorMessage("")).toBe(false);
    });
  });

  describe("stripErrorMarker", () => {
    it("should remove error marker and whitespace", () => {
      expect(stripErrorMarker("❌ 翻译失败")).toBe("翻译失败");
      expect(stripErrorMarker("❌  多个空格")).toBe("多个空格");
    });

    it("should not modify text without error marker", () => {
      expect(stripErrorMarker("正常文本")).toBe("正常文本");
    });
  });

  describe("hasContent", () => {
    it("should return true for non-empty text", () => {
      expect(hasContent("hello")).toBe(true);
      expect(hasContent("  text  ")).toBe(true);
    });

    it("should return false for empty or whitespace-only text", () => {
      expect(hasContent("")).toBe(false);
      expect(hasContent("   ")).toBe(false);
      expect(hasContent("\n\t")).toBe(false);
    });
  });

  describe("truncateText", () => {
    it("should truncate text exceeding max length", () => {
      expect(truncateText("hello world", 5)).toBe("hello");
    });

    it("should preserve Unicode characters when truncating", () => {
      expect(truncateText("你好世界朋友", 3)).toBe("你好世");
    });

    it("should not modify text within limit", () => {
      expect(truncateText("hello", 10)).toBe("hello");
    });
  });

  describe("isWithinLimit", () => {
    it("should return true when within limit", () => {
      expect(isWithinLimit("hello", 10)).toBe(true);
      expect(isWithinLimit("你好", 5)).toBe(true);
    });

    it("should return false when exceeding limit", () => {
      expect(isWithinLimit("hello world", 5)).toBe(false);
    });

    it("should return true when exactly at limit", () => {
      expect(isWithinLimit("hello", 5)).toBe(true);
    });
  });
});
