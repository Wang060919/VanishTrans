interface CharCounterProps {
  current: number;
  max: number;
  className?: string;
  compact?: boolean;
}

export default function CharCounter({ current, max, className, compact = false }: CharCounterProps) {
  const ratio = Math.min(current / max, 1);
  const pct = Math.round(ratio * 100);
  const warn = ratio >= 0.9;

  if (compact) {
    return (
      <span className={`compact-counter ${warn ? "compact-counter--warn" : ""} ${className || ""}`}>
        {current.toLocaleString()} / {max.toLocaleString()}
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 text-[10px] text-text-muted select-none ${className || ""}`}>
      <div className="flex-1 h-[3px] rounded-full bg-border-subtle overflow-hidden">
        <div
          className="h-full rounded-full origin-left transition-transform duration-200"
          style={{
            transform: `scaleX(${pct / 100})`,
            backgroundColor: warn ? "var(--color-danger)" : "var(--color-signal)",
          }}
        />
      </div>
      <span className={warn ? "text-danger font-medium" : ""}>
        {current.toLocaleString()} / {max.toLocaleString()}
      </span>
    </div>
  );
}
