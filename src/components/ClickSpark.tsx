import { MouseEvent, ReactNode, useCallback, useEffect, useRef } from "react";

interface ClickSparkProps {
  children: ReactNode;
  color?: string;
  count?: number;
  className?: string;
}

export default function ClickSpark({ children, color = "var(--color-primary)", count = 8, className }: ClickSparkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      particlesRef.current.forEach((p) => p.remove());
    };
  }, []);

  const createParticles = useCallback((e: MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    particlesRef.current.forEach((p) => p.remove());
    particlesRef.current = [];
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const dist = 20 + Math.random() * 20;
      const el = document.createElement("div");
      const size = 3 + Math.random() * 3;

      Object.assign(el.style, {
        position: "absolute",
        left: `${cx - size / 2}px`,
        top: `${cy - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        backgroundColor: color,
        pointerEvents: "none",
        zIndex: "9999",
        opacity: "1",
        transform: "translate(0,0) scale(1)",
        transition: "all 0.3s ease-out",
      });

      containerRef.current?.appendChild(el);
      particlesRef.current.push(el);

      requestAnimationFrame(() => {
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        el.style.transform = `translate(${dx}px, ${dy}px) scale(0)`;
        el.style.opacity = "0";
      });

      const tid = setTimeout(() => {
        el.remove();
        particlesRef.current = particlesRef.current.filter((p) => p !== el);
        timersRef.current = timersRef.current.filter((t) => t !== tid);
      }, 350);
      timersRef.current.push(tid);
    }
  }, [color, count]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className || ""}`} onClick={createParticles}>
      {children}
    </div>
  );
}
