import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEventHandler, type ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import IconButton from "./IconButton";

interface OverlayDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  hideBack?: boolean;
  fullSize?: boolean;
  onHeaderMouseDown?: MouseEventHandler<HTMLElement>;
}

export default function OverlayDrawer({ open, title, onClose, children, actions, fullSize = false, onHeaderMouseDown, onBack, backLabel = "返回翻译", hideBack = false }: OverlayDrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !fullSize) return;
    const previous = document.activeElement;
    const layer = panelRef.current?.parentElement;
    const siblings = Array.from(layer?.parentElement?.children ?? [])
      .filter((node) => node !== layer)
      .map((node) => ({ node, inert: node.getAttribute("inert") }));
    siblings.forEach(({ node }) => node.setAttribute("inert", ""));
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      siblings.forEach(({ node, inert }) => {
        if (inert === null) node.removeAttribute("inert");
        else node.setAttribute("inert", inert);
      });
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, fullSize]);

  const containFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!fullSize || event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )).filter((node) => node.tabIndex >= 0 && !node.closest("[hidden], [inert]"));
    const target = event.shiftKey ? controls.at(-1) : controls[0];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge && target) { event.preventDefault(); target.focus(); }
  };

  if (!open) return null;

  return (
    <div className={"drawer-layer" + (fullSize ? " drawer-layer--full" : "")}>
      <button className="drawer-backdrop" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <section ref={panelRef} onKeyDown={containFocus} className="overlay-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header" onMouseDown={onHeaderMouseDown}>
          <div className="drawer-heading">
            {fullSize && !hideBack ? <IconButton icon={<ChevronLeft size={19} />} label={backLabel} onClick={onBack ?? onClose} /> : <span className="drawer-back-spacer" aria-hidden="true" />}
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

