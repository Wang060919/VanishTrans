import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";

interface OverlayDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

export default function OverlayDrawer({ open, title, onClose, children, actions }: OverlayDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <section className="overlay-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div className="drawer-heading">
            <span className="signal-node" aria-hidden="true" />
            <h2 id="drawer-title">{title}</h2>
          </div>
          <div className="drawer-actions">
            {actions}
            <IconButton icon={<X size={16} />} label={`关闭${title}`} onClick={onClose} />
          </div>
        </header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  );
}

