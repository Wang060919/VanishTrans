interface CharCounterProps {
  current: number;
  max: number;
  className?: string;
}

export default function CharCounter({ current, max, className }: CharCounterProps) {
  const ratio = Math.min(current / max, 1);
  const pct = Math.round(ratio * 100);
  const warn = ratio >= 0.9;

  return (
    <div className={`flex items-center gap-2 text-[10px] text-text-muted select-none ${className || ""}`}>
      <div className="flex-1 h-[3px] rounded-full bg-border-subtle overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{
            width: `${pct}%`,
            backgroundColor: warn ? "var(--color-danger)" : "var(--color-primary)",
          }}
        />
      </div>
      <span className={warn ? "text-danger font-medium" : ""}>
        {current.toLocaleString()} / {max.toLocaleString()}
      </span>
    </div>
  );
}
