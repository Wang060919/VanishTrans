import { finishOcr, cancelScreenshot as cancelScreenshotCmd, getScreenshotPayload, runOcrOnCrop } from './services/tauriBridge';
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";

interface Rect {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

interface ScreenshotPayload {
  dataUri: string;
  imageWidth: number;
  imageHeight: number;
  monitorX: number;
  monitorY: number;
  monitorWidth: number;
  monitorHeight: number;
  scaleFactor: number;
  smartRegions?: SmartSelectionRegion[];
}

interface SmartSelectionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MANUAL_DRAG_THRESHOLD = 6;

export default function ScreenshotOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const drawingRef = useRef(false);
  const manualDragRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const smartCandidateRef = useRef<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const payloadRef = useRef<ScreenshotPayload | null>(null);
  const sessionRef = useRef(0);
  const ocrPendingRef = useRef(false);

  const loadNewImage = useCallback((payload: ScreenshotPayload) => {
    sessionRef.current += 1;
    payloadRef.current = payload;
    ocrPendingRef.current = false;
    setImgLoaded(false);
    setStatus("");
    drawingRef.current = false;
    manualDragRef.current = false;
    pointerDownRef.current = null;
    smartCandidateRef.current = null;
    rectRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (imgRef.current) {
      // Assign directly so errors from the replacement resource remain visible.
      imgRef.current.src = payload.dataUri;
    }
  }, []);

  const fetchLatest = useCallback(() => {
    getScreenshotPayload()
      .then((payload) => loadNewImage(payload))
      .catch(() => setStatus("截图加载失败，点击重试"));
  }, [loadNewImage]);

  useEffect(() => {
    fetchLatest();
    const setup = async () => {
      const unlisten = await listen<ScreenshotPayload>("screenshot-ready", (event) => {
        if (event.payload) {
          loadNewImage(event.payload);
        } else {
          fetchLatest();
        }
      });
      return unlisten;
    };
    const p = setup();
    return () => {
      p.then((fn) => fn()).catch(() => {});
    };
  }, [fetchLatest, loadNewImage]);

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
    ctx.clearRect(0, 0, w, h);
    setImgLoaded(true);
  }, []);

  const redraw = useCallback((sel: Rect | null, smart = false) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!sel) return;
    const x = Math.min(sel.startX, sel.curX);
    const y = Math.min(sel.startY, sel.curY);
    const rw = Math.abs(sel.curX - sel.startX);
    const rh = Math.abs(sel.curY - sel.startY);
    if (rw < 2 || rh < 2) return;
    const styles = getComputedStyle(canvas);
    ctx.fillStyle = smart
      ? "rgba(124, 145, 255, 0.09)"
      : styles.getPropertyValue("--color-signal-soft").trim() || "rgba(124, 145, 255, 0.12)";
    ctx.fillRect(x, y, rw, rh);
    ctx.strokeStyle = styles.getPropertyValue("--color-signal").trim() || "#7c91ff";
    ctx.lineWidth = 1;
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

  const findSmartRegion = useCallback((clientX: number, clientY: number): Rect | null => {
    const payload = payloadRef.current;
    if (!payload) return null;
    const scaleX = window.innerWidth / payload.imageWidth;
    const scaleY = window.innerHeight / payload.imageHeight;
    const region = (payload.smartRegions ?? []).find((candidate) => {
      const x = candidate.x * scaleX;
      const y = candidate.y * scaleY;
      const right = x + candidate.width * scaleX;
      const bottom = y + candidate.height * scaleY;
      return clientX >= x && clientX <= right && clientY >= y && clientY <= bottom;
    });
    if (!region) return null;
    return {
      startX: region.x * scaleX,
      startY: region.y * scaleY,
      curX: (region.x + region.width) * scaleX,
      curY: (region.y + region.height) * scaleY,
    };
  }, []);

  const doOcr = useCallback(async (sel: Rect) => {
    const payload = payloadRef.current;
    if (!payload || ocrPendingRef.current) return;
    const x = Math.min(sel.startX, sel.curX);
    const y = Math.min(sel.startY, sel.curY);
    const w = Math.abs(sel.curX - sel.startX);
    const h = Math.abs(sel.curY - sel.startY);
    if (w < 10 || h < 10) return;
    ocrPendingRef.current = true;
    const session = sessionRef.current;
    setStatus("OCR 识别中...");
    const scaleX = payload.imageWidth / window.innerWidth;
    const scaleY = payload.imageHeight / window.innerHeight;
    const cropX = Math.round(x * scaleX);
    const cropY = Math.round(y * scaleY);
    const cropW = Math.round(w * scaleX);
    const cropH = Math.round(h * scaleY);
    try {
      const result = await runOcrOnCrop({
        x: cropX, y: cropY, w: cropW, h: cropH,
      });
      if (session !== sessionRef.current) return;
      const text = result.text;
      if (text.trim()) {
        setStatus("");
        await finishOcr({ text });
      } else {
        setStatus("未识别到文字，点击任意位置重试");
        drawingRef.current = false;
        smartCandidateRef.current = null;
        rectRef.current = null;
      }
    } catch (error) {
      if (session !== sessionRef.current) return;
      setStatus(`OCR 失败: ${errorMessage(error)}，点击重试`);
      drawingRef.current = false;
      smartCandidateRef.current = null;
      rectRef.current = null;
    } finally {
      if (session === sessionRef.current) {
        ocrPendingRef.current = false;
      }
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!imgLoaded) {
      if (status) {
        setStatus("");
        fetchLatest();
      }
      return;
    }
    if (ocrPendingRef.current) return;
    if (status) {
      setStatus("");
      redraw(null);
    }
    drawingRef.current = true;
    manualDragRef.current = false;
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    const smart = findSmartRegion(e.clientX, e.clientY);
    smartCandidateRef.current = smart;
    const r = smart ?? { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY };
    rectRef.current = r;
    redraw(r, Boolean(smart));
  }, [fetchLatest, findSmartRegion, imgLoaded, redraw, status]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawingRef.current) {
      if (!imgLoaded || ocrPendingRef.current || status) return;
      const smart = findSmartRegion(e.clientX, e.clientY);
      smartCandidateRef.current = smart;
      rectRef.current = smart;
      redraw(smart, Boolean(smart));
      return;
    }
    const pointerDown = pointerDownRef.current;
    if (!pointerDown) return;
    const distance = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    if (distance >= MANUAL_DRAG_THRESHOLD) manualDragRef.current = true;
    if (!manualDragRef.current && smartCandidateRef.current) {
      rectRef.current = smartCandidateRef.current;
      redraw(smartCandidateRef.current, true);
      return;
    }
    const r = {
      startX: pointerDown.x,
      startY: pointerDown.y,
      curX: e.clientX,
      curY: e.clientY,
    };
    rectRef.current = r;
    redraw(r);
  }, [findSmartRegion, imgLoaded, redraw, status]);

  const onMouseUp = useCallback(async () => {
    if (!drawingRef.current || !rectRef.current) return;
    drawingRef.current = false;
    pointerDownRef.current = null;
    const selection = rectRef.current;
    smartCandidateRef.current = null;
    manualDragRef.current = false;
    await doOcr(selection);
  }, [doOcr]);

  const cancelScreenshot = useCallback(async () => {
    sessionRef.current += 1;
    payloadRef.current = null;
    ocrPendingRef.current = false;
    drawingRef.current = false;
    manualDragRef.current = false;
    pointerDownRef.current = null;
    smartCandidateRef.current = null;
    rectRef.current = null;
    setStatus("");
    try {
      await cancelScreenshotCmd();
    } catch {
      await getCurrentWindow().hide();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void cancelScreenshot();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelScreenshot]);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    void cancelScreenshot();
  }, [cancelScreenshot]);

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
    >
      <img
        ref={imgRef}
        onLoad={handleImgLoad}
        onError={() => setStatus("截图加载失败，点击重试")}
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
