import { ReactNode } from "react";

interface IconButtonProps {
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
  className?: string;
}

export default function IconButton({ icon, active, onClick, title, className }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        `w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all ` +
        (active
          ? "bg-primary-soft text-primary shadow-sm "
          : "hover:bg-black/5 dark:hover:bg-white/10 text-text-muted ") +
        (className || "")
      }
    >
      {icon}
    </button>
  );
}
