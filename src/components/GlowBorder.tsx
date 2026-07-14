import { ReactNode, useEffect, useState } from "react";

interface GlowBorderProps {
  children: ReactNode;
  active?: boolean;
  color?: string;
  duration?: number;
  className?: string;
}

/**
 * GlowBorder — CSS-driven pulsing glow effect. Re-renders only on active toggle.
 */
export default function GlowBorder({ children, active, color = "var(--color-primary)", duration = 1500, className }: GlowBorderProps) {
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    if (active) {
      setGlowing(true);
      const timer = setTimeout(() => setGlowing(false), duration);
      return () => clearTimeout(timer);
    }
  }, [active, duration]);

  return (
    <div
      className={className}
      style={{
        borderRadius: "0.75rem",
        ...(glowing
          ? {
              "--glow-color": color,
              "--glow-alpha": `color-mix(in srgb, ${color} 25%, transparent)`,
              animation: "glowPulse 1.5s ease-in-out",
            }
          : {}),
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
