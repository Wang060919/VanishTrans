import type { ReactNode } from "react";

interface SignalBurstProps {
  active: boolean;
  children: ReactNode;
  className?: string;
}

export default function SignalBurst({ active, children, className = "" }: SignalBurstProps) {
  return (
    <span className={`signal-burst ${active ? "signal-burst--active" : ""} ${className}`}>
      {children}
      <span className="signal-burst__particles" aria-hidden="true">
        <i /><i /><i /><i />
      </span>
    </span>
  );
}
