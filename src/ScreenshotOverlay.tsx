import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

interface Rect {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export default function ScreenshotOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const drawingRef = useRef(false);
  const rectRef = useRef<Rect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNewImage = useCallback((uri: string) => {
    setImgLoaded(false);
    setStatus("");
    drawingRef.current = false;
    rectRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (imgRef.current) {
      imgRef.current.removeAttribute("src");
      requestAnimationFrame(() => {
        if (imgRef.current) imgRef.current.src = uri;
      });
    }
  }, []);

  const fetchLatest = useCallback(() => {
    invoke<string>("get_screenshot_data_uri")
      .then((uri) => loadNewImage(uri))
      .catch(() => {});
  }, [loadNewImage]);

  useEffect(() => {
    fetchLatest();
    const setup = async () => {
      const unlisten = await listen<string>("screenshot-ready", (event) => {
        if (event.payload) {
          loadNewImage(event.payload);
        } else {
          fetchLatest();
        }
      });
      return unlisten;
    };
    const p = setup();
    window.addEventListener("focus", fetchLatest);
    return () => {
      p.then((fn) => fn());
      window.removeEventListener("focus", fetchLatest);
    };
  }, [fetchLatest]);

  const handleImgLoad = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(0, 0, w, h);
    setImgLoaded(true);
  }, []);

  const redraw = useCallback((sel: Rect | null) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(0, 0, w, h);
    if (!sel) return;
    const x = Math.min(sel.startX, sel.curX);
    const y = Math.min(sel.startY, sel.curY);
    const rw = Math.abs(sel.curX - sel.startX);
    const rh = Math.abs(sel.curY - sel.startY);
    if (rw < 2 || rh < 2) return;
    ctx.clearRect(x, y, rw, rh);
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--color-primary").trim() || "#0078d4";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, rw, rh);
    const label = `${Math.round(rw)} × ${Math.round(rh)}`;
    ctx.font = "12px 'Segoe UI', sans-serif";
    const m = ctx.measureText(label);
    const lx = x + rw - m.width - 8;
    const ly = y + rh + 20 > h ? y - 24 : y + rh + 18;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(lx - 4, ly - 14, m.width + 8, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, lx, ly);
  }, []);

  const doOcr = useCallback(async (sel: Rect) => {
    const img = imgRef.current;
    if (!img) return;
    const x = Math.min(sel.startX, sel.curX);
    const y = Math.min(sel.startY, sel.curY);
    const w = Math.abs(sel.curX - sel.startX);
    const h = Math.abs(sel.curY - sel.startY);
    if (w < 10 || h < 10) return;
    setStatus("OCR 识别中...");
    const scaleX = img.naturalWidth / window.innerWidth;
    const scaleY = img.naturalHeight / window.innerHeight;
    const cropX = Math.round(x * scaleX);
    const cropY = Math.round(y * scaleY);
    const cropW = Math.round(w * scaleX);
    const cropH = Math.round(h * scaleY);
    try {
      const result = await invoke<{ text: string; confidence: number }>("run_ocr_on_crop", {
        x: cropX, y: cropY, w: cropW, h: cropH,
      });
      const text = result.text;
      const confidence = result.confidence;
      if (text.trim()) {
        const pct = Math.round(confidence * 100);
        setStatus(`识别置信度: ${pct}%`);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setStatus("");
          invoke("clear_screenshot_buffer").then(() => invoke("finish_ocr", { text }));
        }, 600);
      } else {
        setStatus("未识别到文字，点击任意位置重试");
        drawingRef.current = false;
        rectRef.current = null;
      }
    } catch (e: any) {
      setStatus(`OCR 失败: ${e}，点击重试`);
      drawingRef.current = false;
      rectRef.current = null;
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!imgLoaded) return;
    if (status) {
      setStatus("");
      redraw(null);
    }
    drawingRef.current = true;
    const r = { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY };
    rectRef.current = r;
    redraw(r);
  }, [imgLoaded, redraw, status]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawingRef.current || !rectRef.current) return;
    const r = { ...rectRef.current, curX: e.clientX, curY: e.clientY };
    rectRef.current = r;
    redraw(r);
  }, [redraw]);

  const onMouseUp = useCallback(async () => {
    if (!drawingRef.current || !rectRef.current) return;
    drawingRef.current = false;
    await doOcr(rectRef.current);
  }, [doOcr]);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen("screenshot-escape", () => {
        invoke("clear_screenshot_buffer");
        getCurrentWindow().hide();
      });
      return unlisten;
    };
    const p = setup();
    return () => { p.then((fn) => fn()); };
  }, []);

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <img
        ref={imgRef}
        onLoad={handleImgLoad}
        onError={() => setStatus("图片加载失败")}
        draggable={false}
        className="absolute inset-0 w-full h-full object-fill block"
      />
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {!imgLoaded && !status && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-overlay text-text-muted text-base z-50">
          加载截图中...
        </div>
      )}
      {status && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/85 text-white px-6 py-3 rounded-lg text-sm z-[9999]">
          {status}
        </div>
      )}
      {imgLoaded && !status && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white/60 text-[13px] pointer-events-none z-[9999]">
          拖拽选取识别区域 · Esc 取消
        </div>
      )}
    </div>
  );
}
