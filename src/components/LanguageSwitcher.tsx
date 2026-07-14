import { ArrowLeftRight } from "lucide-react";
import type { LangDirection } from "../hooks/useTranslation";

interface LanguageSwitcherProps {
  value: LangDirection;
  onChange: (direction: LangDirection) => void;
}

type SourceLanguage = "auto" | "zh" | "en";
type TargetLanguage = "smart" | "zh" | "en";

function decodeDirection(value: LangDirection): { source: SourceLanguage; target: TargetLanguage } {
  switch (value) {
    case "zh2en": return { source: "zh", target: "en" };
    case "en2zh": return { source: "en", target: "zh" };
    case "auto2en": return { source: "auto", target: "en" };
    case "auto2zh": return { source: "auto", target: "zh" };
    default: return { source: "auto", target: "smart" };
  }
}

export default function LanguageSwitcher({ value, onChange }: LanguageSwitcherProps) {
  const { source, target } = decodeDirection(value);
  const canSwap = value === "zh2en" || value === "en2zh";

  const changeSource = (next: SourceLanguage) => {
    if (next === "auto") {
      onChange(target === "en" ? "auto2en" : target === "zh" ? "auto2zh" : "auto");
      return;
    }
    onChange(next === "zh" ? "zh2en" : "en2zh");
  };

  const changeTarget = (next: TargetLanguage) => {
    if (next === "smart") {
      onChange("auto");
      return;
    }
    if (source === "zh" && next === "en") onChange("zh2en");
    else if (source === "en" && next === "zh") onChange("en2zh");
    else onChange(next === "en" ? "auto2en" : "auto2zh");
  };

  return (
    <div className="language-switcher" aria-label="翻译语言">
      <label className="language-field">
        <span className="sr-only">源语言</span>
        <select aria-label="源语言" value={source} onChange={(event) => changeSource(event.target.value as SourceLanguage)}>
          <option value="auto">自动检测</option>
          <option value="zh">中文</option>
          <option value="en">英语</option>
        </select>
      </label>
      <button
        type="button"
        className="language-swap"
        aria-label="交换语言"
        disabled={!canSwap}
        onClick={() => onChange(value === "zh2en" ? "en2zh" : "zh2en")}
      >
        <ArrowLeftRight size={15} aria-hidden="true" />
      </button>
      <label className="language-field language-field--target">
        <span className="sr-only">目标语言</span>
        <select aria-label="目标语言" value={target} onChange={(event) => changeTarget(event.target.value as TargetLanguage)}>
          <option value="smart">智能选择</option>
          <option value="zh">中文</option>
          <option value="en">英语</option>
        </select>
      </label>
    </div>
  );
}
