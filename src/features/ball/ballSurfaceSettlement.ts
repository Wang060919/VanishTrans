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
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new IslandTransitionAbortedError());
    signal.addEventListener("abort", abort, { once: true });
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => { signal.removeEventListener("abort", abort); resolve(); },
      () => { signal.removeEventListener("abort", abort); reject(new IslandTransitionAbortedError()); },
    );
  });
  // Leave rendering opportunities for the final small island before changing
  // the native viewport. A CSS completion callback runs before presentation.
  await waitForIslandPaint(signal);
}
