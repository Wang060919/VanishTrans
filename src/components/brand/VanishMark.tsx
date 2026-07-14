import type { CSSProperties } from "react";

interface VanishMarkProps {
  compact?: boolean;
  className?: string;
  animated?: boolean;
  decorative?: boolean;
}

export default function VanishMark({ compact = false, className = "", animated = true, decorative = false }: VanishMarkProps) {
  return (
    <div
      className={`brand-lockup ${animated ? "brand-lockup--animated" : ""} ${className}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "VanishTrans"}
      aria-hidden={decorative || undefined}
    >
      <svg className="brand-mark" viewBox="0 0 28 24" aria-hidden="true">
        <path className="brand-mark__solid" d="M3.5 4.5 12.8 20 17.4 12.4" />
        <path className="brand-mark__signal brand-mark__signal--one" d="m18.7 10.2 3.4-5.7" />
        <path className="brand-mark__signal brand-mark__signal--two" d="m22.6 8 1.9-3.2" />
        <circle className="brand-mark__node" cx="18.2" cy="11.1" r="1.35" />
      </svg>
      {!compact && (
        <span className="brand-wordmark" style={{ "--brand-delay": "80ms" } as CSSProperties}>
          <span>Vanish</span><span className="brand-wordmark__muted">Trans</span>
        </span>
      )}
    </div>
  );
}
