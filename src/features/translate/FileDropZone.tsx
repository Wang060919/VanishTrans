import { FileText } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";

interface FileDropZoneProps {
  onDrop: (filename: string, content: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/**
 * FileDropZone - handles file drag-and-drop overlay.
 * Single responsibility: file drop interaction and parsing.
 */
export default function FileDropZone({ onDrop, disabled = false, children }: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const dragOverCounter = useRef(0);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current += 1;
    if (event.dataTransfer.types.includes("Files")) {
      setDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current -= 1;
    if (dragOverCounter.current <= 0) {
      dragOverCounter.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current = 0;
    setDragging(false);

    if (disabled) return;

    const file = event.dataTransfer.files[0];
    if (!file) return;


    if (file.size > MAX_FILE_BYTES) {
      window.alert(`文件过大：${(file.size / 1024 / 1024).toFixed(1)} MB，最多支持 10 MB。`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      onDrop(file.name, content);
    };
    reader.onerror = () => {
      window.alert("读取文件失败，请检查文件是否可访问。");
    };
    reader.readAsText(file);
  }, [disabled, onDrop]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="file-drop-overlay" role="status">
          <FileText size={28} aria-hidden="true" />
          <strong>释放文件以翻译</strong>
          <span>支持 TXT、SRT 和 JSON</span>
        </div>
      )}
      {children}
    </div>
  );
}
