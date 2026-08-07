import type { IslandMode, IslandMotion } from "./islandModel";

export type IslandTransitionReason =
  | "user"
  | "focus-loss"
  | "business"
  | "keyboard"
  | "recovery";

export interface IslandTransitionRequest {
  target: IslandMode;
  motion: IslandMotion;
  reason: IslandTransitionReason;
}

export interface IslandTransitionContext {
  generation: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

type IslandTransitionExecutor = (
  request: IslandTransitionRequest,
  context: IslandTransitionContext,
) => Promise<void>;

interface TransitionTask {
  request: IslandTransitionRequest;
  executor: IslandTransitionExecutor;
  generation: number;
  controller: AbortController;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class IslandTransitionAbortedError extends Error {
  constructor() {
    super("Island transition was superseded");
    this.name = "IslandTransitionAbortedError";
  }
}

export function isIslandTransitionAborted(error: unknown) {
  return error instanceof IslandTransitionAbortedError;
}

export function waitForIslandTransition(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new IslandTransitionAbortedError());
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new IslandTransitionAbortedError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export function waitForIslandPaint(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new IslandTransitionAbortedError());

  return new Promise<void>((resolve, reject) => {
    let frameId = 0;
    const handleAbort = () => {
      cancelAnimationFrame(frameId);
      reject(new IslandTransitionAbortedError());
    };
    const finish = () => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    frameId = requestAnimationFrame(() => {
      if (signal.aborted) return;
      frameId = requestAnimationFrame(() => {
        if (signal.aborted) return;
        frameId = requestAnimationFrame(finish);
      });
    });
  });
}

function requestsMatch(first: IslandTransitionRequest, second: IslandTransitionRequest) {
  return first.target === second.target
    && first.motion === second.motion
    && first.reason === second.reason;
}

export class IslandTransitionCoordinator {
  private active: TransitionTask | null = null;
  private pending: TransitionTask | null = null;
  private draining = false;
  private paused = false;
  private disposed = false;
  private nextGeneration = 0;

  get isTransitioning() {
    return this.active !== null;
  }

  get requestedTarget(): IslandMode | null {
    return this.pending?.request.target ?? this.active?.request.target ?? null;
  }

  request(request: IslandTransitionRequest, executor: IslandTransitionExecutor) {
    if (this.disposed) return Promise.resolve();

    const desiredTask = this.pending ?? this.active;
    if (desiredTask && requestsMatch(desiredTask.request, request)) {
      return desiredTask.promise;
    }

    const task = this.createTask(request, executor);
    if (this.pending) this.pending.resolve();
    this.pending = task;
    this.active?.controller.abort();
    void this.drain();
    return task.promise;
  }

  setPaused(paused: boolean) {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (!paused) void this.drain();
  }

  dispose() {
    this.disposed = true;
    this.active?.controller.abort();
    this.pending?.resolve();
    this.pending = null;
  }

  private createTask(
    request: IslandTransitionRequest,
    executor: IslandTransitionExecutor,
  ): TransitionTask {
    let resolve = () => {};
    let reject = () => {};
    const promise = new Promise<void>((taskResolve, taskReject) => {
      resolve = taskResolve;
      reject = taskReject;
    });
    return {
      request,
      executor,
      generation: ++this.nextGeneration,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
    };
  }

  private async drain() {
    if (this.draining || this.paused || this.disposed) return;
    this.draining = true;
    try {
      while (!this.paused && !this.disposed && this.pending) {
        const task = this.pending;
        this.pending = null;
        this.active = task;
        try {
          await task.executor(task.request, {
            generation: task.generation,
            signal: task.controller.signal,
            isCurrent: () => !task.controller.signal.aborted
              && !this.disposed
              && this.active === task,
          });
          task.resolve();
        } catch (error) {
          if (task.controller.signal.aborted || isIslandTransitionAborted(error)) {
            task.resolve();
          } else {
            task.reject(error);
          }
        } finally {
          if (this.active === task) this.active = null;
        }
      }
    } finally {
      this.draining = false;
      if (!this.paused && !this.disposed && this.pending) void this.drain();
    }
  }
}
