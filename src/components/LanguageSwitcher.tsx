import { ArrowLeftRight, Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LangDirection } from "../hooks/useTranslation";

interface LanguageSwitcherProps {
  value: LangDirection;
  onChange: (direction: LangDirection) => void;
  disabled?: boolean;
}

type SourceLanguage = "auto" | "zh" | "en";
type TargetLanguage = "smart" | "zh" | "en";
type OpenMenu = "source" | "target" | null;

const SOURCE_OPTIONS: ReadonlyArray<{ value: SourceLanguage; label: string }> = [
  { value: "auto", label: "自动检测" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
];

const TARGET_OPTIONS: ReadonlyArray<{ value: TargetLanguage; label: string }> = [
  { value: "smart", label: "智能选择" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
];

function decodeDirection(value: LangDirection): { source: SourceLanguage; target: TargetLanguage } {
  switch (value) {
    case "zh2en": return { source: "zh", target: "en" };
    case "en2zh": return { source: "en", target: "zh" };
    case "auto2en": return { source: "auto", target: "en" };
    case "auto2zh": return { source: "auto", target: "zh" };
    default: return { source: "auto", target: "smart" };
  }
}

interface LanguageMenuProps<T extends string> {
  align?: "start" | "end";
  disabled: boolean;
  label: string;
  onClose: () => void;
  onOpen: () => void;
  onSelect: (value: T) => void;
  open: boolean;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
}

function LanguageMenu<T extends string>({
  align = "start",
  disabled,
  label,
  onClose,
  onOpen,
  onSelect,
  open,
  options,
  value,
}: LanguageMenuProps<T>) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    optionRefs.current[selectedIndex]?.focus();
  }, [open, options, value]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      onClose();
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + options.length) % options.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  };

  const selectOption = (nextValue: T) => {
    onSelect(nextValue);
    onClose();
    triggerRef.current?.focus();
  };

  return (
    <div className={`language-field language-field--${align}`}>
      <button
        ref={triggerRef}
        type="button"
        className="language-menu-trigger"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}：${selectedOption.label}`}
        disabled={disabled}
        onClick={() => (open ? onClose() : onOpen())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown size={14} aria-hidden="true" className={open ? "language-menu-trigger__icon language-menu-trigger__icon--open" : "language-menu-trigger__icon"} />
      </button>
      {open && (
        <div
          id={menuId}
          className="language-menu"
          role="listbox"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "language-menu__option language-menu__option--selected" : "language-menu__option"}
              onClick={() => selectOption(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LanguageSwitcher({ value, onChange, disabled = false }: LanguageSwitcherProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const { source, target } = decodeDirection(value);
  const canSwap = value === "zh2en" || value === "en2zh";

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [openMenu]);

  useEffect(() => {
    if (disabled) setOpenMenu(null);
  }, [disabled]);

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
    <div ref={rootRef} className="language-switcher" aria-label="翻译语言">
      <LanguageMenu
        label="源语言"
        value={source}
        options={SOURCE_OPTIONS}
        disabled={disabled}
        open={openMenu === "source"}
        onOpen={() => setOpenMenu("source")}
        onClose={() => setOpenMenu(null)}
        onSelect={changeSource}
      />
      <button
        type="button"
        className="language-swap"
        aria-label="交换语言"
        disabled={!canSwap || disabled}
        onClick={() => onChange(value === "zh2en" ? "en2zh" : "zh2en")}
      >
        <ArrowLeftRight size={15} aria-hidden="true" />
      </button>
      <LanguageMenu
        align="end"
        label="目标语言"
        value={target}
        options={TARGET_OPTIONS}
        disabled={disabled}
        open={openMenu === "target"}
        onOpen={() => setOpenMenu("target")}
        onClose={() => setOpenMenu(null)}
        onSelect={changeTarget}
      />
    </div>
  );
}
