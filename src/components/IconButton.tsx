import type { ReactNode } from "react";

interface IconButtonProps {
  icon: ReactNode;
  label: string;
  /** Short text shown next to the icon; `label` remains the accessible name. */
  text?: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
}

export default function IconButton({ icon, label, text, active, onClick, title, className = "", disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      className={`icon-button ${active ? "icon-button--active" : ""} ${text ? "icon-button--labeled" : ""} ${className}`}
    >
      {icon}
      {text && <span className="icon-button__text" aria-hidden="true">{text}</span>}
    </button>
  );
}
