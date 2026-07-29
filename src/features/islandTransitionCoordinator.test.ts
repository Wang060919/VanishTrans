import { describe, expect, it, vi } from "vitest";
import {
  IslandTransitionCoordinator,
  waitForIslandTransition,
  type IslandTransitionRequest,
} from "./islandTransitionCoordinator";

const animatedRequest = (target: IslandTransitionRequest["target"]): IslandTransitionRequest => ({
  target,
  motion: "animated",
  reason: "user",
});

describe("IslandTransitionCoordinator", () => {
  it("aborts an obsolete settle and immediately runs the latest request", async () => {
    vi.useFakeTimers();
    const coordinator = new IslandTransitionCoordinator();
    const events: string[] = [];
    const execute = async (request: IslandTransitionRequest, { signal }: { signal: AbortSignal }) => {
      events.push(`start:${request.target}`);
      await waitForIslandTransition(280, signal);
      events.push(`complete:${request.target}`);
    };

    const expanding = coordinator.request(animatedRequest("full"), execute);
    await vi.advanceTimersByTimeAsync(0);
    const collapsing = coordinator.request(animatedRequest("idle"), execute);
    await vi.runAllTimersAsync();
    await Promise.all([expanding, collapsing]);

    expect(events).toEqual(["start:full", "start:idle", "complete:idle"]);
  });

  it("coalesces requests while native dragging has transitions paused", async () => {
    const coordinator = new IslandTransitionCoordinator();
    const events: string[] = [];
    const execute = async (request: IslandTransitionRequest) => {
      events.push(request.target);
    };

    coordinator.setPaused(true);
    const first = coordinator.request(animatedRequest("full"), execute);
    const second = coordinator.request(animatedRequest("status"), execute);
    const latest = coordinator.request(animatedRequest("idle"), execute);
    await Promise.resolve();
    expect(events).toEqual([]);

    coordinator.setPaused(false);
    await Promise.all([first, second, latest]);
    expect(events).toEqual(["idle"]);
  });

  it("deduplicates the same desired transition", () => {
    const coordinator = new IslandTransitionCoordinator();
    coordinator.setPaused(true);
    const request = animatedRequest("full");
    const executor = async () => {};

    expect(coordinator.request(request, executor)).toBe(coordinator.request(request, executor));
    coordinator.dispose();
  });
});
