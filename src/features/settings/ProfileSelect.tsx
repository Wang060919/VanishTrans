import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ServiceProfile } from "../../types";

interface ProfileSelectProps {
  profiles: ServiceProfile[];
  value: string;
  disabled: boolean;
  onChange: (name: string) => void;
}

/** The popup stays inside the dialog, beyond the settings scroll clipping area. */
export default function ProfileSelect({ profiles, value, disabled, onChange }: ProfileSelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [popup, setPopup] = useState<{ host: HTMLElement; style: CSSProperties } | null>(null);
  const activeIndex = Math.min(active, profiles.length - 1);
  const visible = open && !disabled && profiles.length > 0;
  const selected = profiles.find((profile) => profile.name === value);

  useLayoutEffect(() => {
    if (!visible || !trigger.current) return;
    const host = trigger.current.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = host.getBoundingClientRect();
    const height = host.clientHeight || window.innerHeight;
    const width = host.clientWidth || window.innerWidth;
    const above = anchor.top - bounds.top - 12;
    const below = height - (anchor.bottom - bounds.top) - 12;
    const upwards = below < Math.min(profiles.length * 50 + 12, 200) && above > below;
    const maxHeight = Math.max(0, Math.min(200, (upwards ? above : below) - 6));
    const popupWidth = Math.min(anchor.width, width - 24);
    setPopup({ host, style: {
      position: host === document.body ? "fixed" : "absolute",
      left: Math.max(12, Math.min(anchor.left - bounds.left, width - popupWidth - 12)),
      width: popupWidth, maxHeight,
      ...(upwards ? { bottom: height - (anchor.top - bounds.top) + 6 } : { top: anchor.bottom - bounds.top + 6 }),
    } });
  }, [visible, profiles.length]);

  useEffect(() => {
    if (!visible) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnScroll);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnScroll);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [visible]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (visible) document.getElementById(id + "-option-" + activeIndex)?.scrollIntoView?.({ block: "nearest" });
  }, [visible, activeIndex, id, popup]);

  const reveal = (last = false) => {
    search.current = { text: "", time: 0 };
    const index = profiles.findIndex((profile) => profile.name === value);
    setActive(index >= 0 ? index : last ? profiles.length - 1 : 0);
    setOpen(true);
  };
  const choose = (index: number) => {
    if (!profiles[index]) return;
    onChange(profiles[index].name);
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && visible) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === "Tab") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!visible) { reveal(event.key === "ArrowUp" || event.key === "End"); return; }
      if (event.key === "Enter" || event.key === " ") { choose(activeIndex); return; }
      setActive(event.key === "Home" ? 0 : event.key === "End" ? profiles.length - 1
        : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + profiles.length) % profiles.length);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - search.current.time < 600 ? search.current.text : "") + event.key.toLocaleLowerCase();
      search.current = { text, time: now };
      const index = profiles.findIndex((profile) => profile.name.toLocaleLowerCase().startsWith(text));
      if (index >= 0) { setActive(index); setOpen(true); }
    }
  };

  return (
    <div className="profile-select">
      <button ref={trigger} type="button" role="combobox" className="profile-select-trigger"
        aria-label="已存配置" aria-haspopup="listbox" aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        aria-activedescendant={visible ? id + "-option-" + activeIndex : undefined}
        disabled={disabled} onClick={() => visible ? setOpen(false) : reveal()}
        onKeyDown={onKeyDown} onBlur={() => setOpen(false)}>
        <span className={selected ? "" : "profile-select-placeholder"}>{selected?.name ?? "选择已存配置"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {visible && popup && createPortal(
        <div ref={menu} id={id} className="profile-select-menu" style={popup.style}
          role="listbox" aria-label="已存配置" onMouseDown={(event) => event.preventDefault()}>
          {profiles.map((profile, index) => (
            <div key={profile.name} id={id + "-option-" + index} role="option"
              aria-selected={profile.name === value} className="profile-select-option"
              data-active={index === activeIndex} onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}>
              <span className="profile-select-copy"><span>{profile.name}</span><small>{profile.model}</small></span>
              {profile.name === value && <Check size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>, popup.host,
      )}
    </div>
  );
}
