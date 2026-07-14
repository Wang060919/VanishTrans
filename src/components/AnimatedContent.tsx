import type { ReactNode } from "react";

interface AnimatedContentProps {
  children: ReactNode;
  className?: string;
  preset?: "fade" | "slide-up" | "drawer";
}

export default function AnimatedContent({ children, className = "", preset = "fade" }: AnimatedContentProps) {
  return <div className={`animated-content animated-content--${preset} ${className}`}>{children}</div>;
}
