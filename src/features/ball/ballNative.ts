import { logError } from "../../lib/logger";
import {
  saveBallPosition as saveBallPositionCmd, setBallWindowBounds as setBallWindowBoundsCmd,
  startScreenshotFromBall, toggleBallShowMain, translateClipboardFromBall,
} from "../../services/tauriBridge";
import { ISLAND_GEOMETRY } from "../islandModel";

export const IDLE_WIDTH = ISLAND_GEOMETRY.idle.width;
export const IDLE_HEIGHT = ISLAND_GEOMETRY.idle.height;
export const FULL_WIDTH = ISLAND_GEOMETRY.full.width;

const COMMAND_MAP: Record<string, () => Promise<void>> = {
  translate_clipboard_from_ball: translateClipboardFromBall,
  start_screenshot_from_ball: startScreenshotFromBall,
  toggle_ball_show_main: toggleBallShowMain,
};

export async function invokeCommand(command: string) {
  const fn = COMMAND_MAP[command];
  if (fn) return fn();
  throw new Error(`未知命令: ${command}`);
}

export async function setBallWindowBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  await setBallWindowBoundsCmd(bounds);
}

export async function saveBallPosition(
  position: { x: number; y: number },
  reposition = true,
) {
  try {
    const saved = await saveBallPositionCmd({
      ...position,
      reposition,
    });
    return Array.isArray(saved) && saved.length === 2
      ? { x: saved[0], y: saved[1] }
      : position;
  } catch (error) {
    // Position persistence is best-effort: keep the in-memory anchor even if
    // writing config.json fails so the island never resets mid-transition.
    logError("ball.position", "save position failed", error);
    return position;
  }
}
