import { ScanLine, X } from "lucide-react";

export default function ScreenshotToolbar({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="screenshot-toolbar" role="toolbar" aria-label="截图操作"
      onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
      <ScanLine size={17} aria-hidden="true" />
      <span>拖拽选区，松开翻译</span>
      <kbd>Esc</kbd>
      <button type="button" onClick={onCancel} aria-label="取消截图" title="取消截图"><X size={16} /></button>
    </div>
  );
}
