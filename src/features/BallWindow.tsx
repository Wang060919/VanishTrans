import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useState } from "react";
import VanishMark from "../components/brand/VanishMark";

/**
 * BallWindow — A 52x52 always-on-top floating ball.
 * - Brand logo as circular button
 * - Drag to reposition
 * - Click to toggle main window visibility
 * - Pulses when translation is in progress
 */
export default function BallWindow() {
  const [translating, setTranslating] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await invoke("toggle_ball_show_main");
    } catch (e) {
      console.error("toggle ball failed", e);
    }
  }, []);

  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const win = getCurrentWindow();
      await win.startDragging();
      // Persist new position after drag
      const pos = await win.outerPosition();
      await invoke("save_ball_position", { x: pos.x, y: pos.y });
    } catch (_) {}
  }, []);

  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        background: translating
          ? "radial-gradient(circle, rgba(83,109,245,0.25) 0%, rgba(83,109,245,0.08) 70%, transparent 100%)"
          : "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(240,242,245,0.9) 100%)",
        boxShadow: translating
          ? "0 0 0 2px rgba(83,109,245,0.4), 0 2px 12px rgba(83,109,245,0.3)"
          : "0 2px 8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.2s, background 0.2s",
        animation: translating ? "ballPulse 1.5s ease-in-out infinite" : "none",
      }}
      onMouseDown={handleDragStart}
      onClick={handleClick}
    >
      <div style={{ pointerEvents: "none", transform: "scale(0.7)" }}>
        <VanishMark />
      </div>
      <style>{`
        @keyframes ballPulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(83,109,245,0.4), 0 2px 12px rgba(83,109,245,0.3); }
          50% { box-shadow: 0 0 0 4px rgba(83,109,245,0.2), 0 2px 20px rgba(83,109,245,0.5); }
        }
      `}</style>
    </div>
  );
}
