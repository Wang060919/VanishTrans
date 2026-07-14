import type { ReactNode } from "react";

interface IconButtonProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
}

export default function IconButton({ icon, label, active, onClick, title, className = "", disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      className={`icon-button ${active ? "icon-button--active" : ""} ${className}`}
    >
      {icon}
    </button>
  );
}
