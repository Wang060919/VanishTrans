import { Children, isValidElement, ReactNode, useEffect, useRef, useState } from "react";

interface AnimatedListProps {
  children: ReactNode;
  stagger?: number;
  className?: string;
}

export default function AnimatedList({ children, stagger = 40, className }: AnimatedListProps) {
  const items = Children.toArray(children);

  return (
    <div className={className}>
      {items.map((child, i) => {
        const key = isValidElement(child) && child.key != null ? child.key : i;
        return (
          <AnimatedItem key={key} index={i} stagger={stagger}>
            {child}
          </AnimatedItem>
        );
      })}
    </div>
  );
}

function AnimatedItem({ children, index, stagger }: { children: ReactNode; index: number; stagger: number }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), index * stagger);
    return () => clearTimeout(timer);
  }, [index, stagger]);

  return (
    <div
      ref={ref}
      className="animate-fade-slide-up"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        animationDelay: `${index * stagger}ms`,
        animationFillMode: "both",
      }}
    >
      {children}
    </div>
  );
}
