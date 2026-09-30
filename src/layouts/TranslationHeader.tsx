import { Minimize2, Minus, Pin, Square, X } from "lucide-react";
import type { MouseEventHandler } from "react";
import IconButton from "../components/IconButton";
import VanishMark from "../components/brand/VanishMark";

interface Props {
  embedded: boolean;
  pinned: boolean;
  onPin: () => void;
  onDrag: MouseEventHandler<HTMLElement>;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export default function TranslationHeader({ embedded, pinned, onPin, onDrag, onMinimize, onMaximize, onClose }: Props) {
  return (
    <header className="app-header" onMouseDown={onDrag}>
      <div className="app-brand"><VanishMark animated={false} /></div>
      <div className="app-header-actions">
        <IconButton icon={<Pin size={16} />} label={pinned ? "取消窗口置顶" : "窗口置顶"} active={pinned} onClick={onPin} />
        <div className="window-controls">
          <button type="button" className="window-controls__btn" onClick={onMinimize}
            aria-label={embedded ? "收起为灵动岛" : "最小化"} title={embedded ? "收起为灵动岛" : "最小化"}>
            {embedded ? <Minimize2 size={16} /> : <Minus size={16} />}
          </button>
          {!embedded && <>
            <button type="button" className="window-controls__btn" onClick={onMaximize} aria-label="最大化" title="最大化"><Square size={13} /></button>
            <button type="button" className="window-controls__btn window-controls__btn--close" onClick={onClose} aria-label="关闭" title="关闭"><X size={17} /></button>
          </>}
        </div>
      </div>
    </header>
  );
}
