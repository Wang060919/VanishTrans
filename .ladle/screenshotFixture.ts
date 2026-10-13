import type { ScreenshotPayload } from "../src/services/tauriBridge";

// A synthetic desktop keeps screenshot previews independent of private screens.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
<rect width="1280" height="720" fill="#192231"/>
<rect x="90" y="90" width="1100" height="530" rx="18" fill="#f5f7fb"/>
<path d="M108 90h1064q18 0 18 18v38H90v-38q0-18 18-18" fill="#e1e6ee"/>
<circle cx="118" cy="118" r="6" fill="#fa6d65"/><circle cx="140" cy="118" r="6" fill="#e7b847"/>
<text x="175" y="124" font-family="sans-serif" font-size="17" fill="#526073">Preview document</text>
<text x="148" y="220" font-family="sans-serif" font-size="30" fill="#192231">Good tools disappear into the work.</text>
<text x="148" y="270" font-family="sans-serif" font-size="23" fill="#526073">They help you stay focused on what matters.</text>
<rect x="145" y="315" width="985" height="170" rx="12" fill="#e7ecf4"/>
<text x="175" y="370" font-family="sans-serif" font-size="22" fill="#192231">Select a region to preview OCR.</text>
<text x="175" y="418" font-family="sans-serif" font-size="18" fill="#526073">This is a synthetic image with no personal data.</text>
</svg>`;

export const SCREENSHOT_PAYLOAD: ScreenshotPayload = {
  sessionId: 1, dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  imageWidth: 1280, imageHeight: 720, monitorX: 0, monitorY: 0,
  monitorWidth: 1280, monitorHeight: 720, scaleFactor: 1,
  smartRegions: [{ x: 145, y: 315, width: 985, height: 170 }, { x: 90, y: 90, width: 1100, height: 530 }],
};
