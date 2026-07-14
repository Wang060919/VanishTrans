import "@testing-library/jest-dom/vitest";

// Polyfill requestAnimationFrame for jsdom (not natively supported)
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}
