import { logInfo } from "../../lib/logger";
import {
  IslandTransitionAbortedError, waitForIslandPaint, waitForIslandTransition,
} from "../islandTransitionCoordinator";

/** Wait for the actual CSS morph, rather than assuming a timer means it painted. */
export async function settleBallSurface(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) throw new IslandTransitionAbortedError();
  const surface = document.querySelector<HTMLElement>(".translation-island__surface");
  if (!surface?.getAnimations) {
    await waitForIslandTransition(milliseconds, signal);
    return;
  }

  // Flush the new class/style so getAnimations includes this transition.
  surface.getBoundingClientRect();
  const animations = surface.getAnimations();
  // The surface geometry morph is a framer-motion spring driven through inline
  // styles, so WAAPI reports nothing for it — fall back to the configured
  // settle budget rather than releasing the clip instantly.
  if (animations.length === 0) {
    await waitForIslandTransition(milliseconds, signal);
    await waitForIslandPaint(signal);
    return;
  }
  // animation.finished can stay pending forever while the webview suspends
  // rendering (occluded/clipped window); cap the wait so the native bounds
  // step still runs and the transition queue cannot wedge.
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: IslandTransitionAbortedError | "timeout") => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error === "timeout") {
        logInfo("ball.settle", "animation.finished timed out — renderer likely suspended", {
          milliseconds, animationCount: animations.length,
        });
        resolve();
        return;
      }
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new IslandTransitionAbortedError());
    const timer = window.setTimeout(() => finish("timeout"), milliseconds + 150);
    signal.addEventListener("abort", abort, { once: true });
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => finish(),
      () => finish(new IslandTransitionAbortedError()),
    );
  });
  // Leave rendering opportunities for the final small island before changing
  // the native viewport. A CSS completion callback runs before presentation.
  await waitForIslandPaint(signal);
}
