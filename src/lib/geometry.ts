import type { StickerRecord } from "./stickers";

export const PANEL_HEIGHT = 135;
export const PANEL_WIDTH = 320;
export const PANEL_BREAKPOINT = 4096;
export const SHEET_PEEK_PX = PANEL_HEIGHT + 96;
export const SHEET_EXPANDED = "calc(100dvh - 3em)";

// Half of `CANVAS.width`/`CANVAS.height` (see ./stickers): stickers store
// coordinates relative to the canvas centre, not its top-left corner.
const CANVAS_HALF = 1500;

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export function stickerCenter(
  s: Pick<StickerRecord, "x" | "y">
): { x: number; y: number } {
  return { x: s.x + CANVAS_HALF, y: s.y + CANVAS_HALF };
}

export function stickerBox(
  s: Pick<StickerRecord, "x" | "y" | "width" | "height">
): { left: number; top: number; width: number; height: number } {
  const center = stickerCenter(s);
  return {
    left: center.x - s.width / 2,
    top: center.y - s.height / 2,
    width: s.width,
    height: s.height,
  };
}

// Port of the old `convertToCanvasCoordinates` (components/Panel.tsx +
// utils/coordinates.ts): narrow viewports dock the panel at the bottom
// (as a peeking sheet), wide viewports dock it on the left.
export function viewTransformFor(
  point: { x: number; y: number },
  scale: number,
  viewport: { w: number; h: number }
): Transform {
  const narrow = viewport.w <= PANEL_BREAKPOINT;
  const xOffset = narrow ? 0 : PANEL_WIDTH;
  const yOffset = narrow ? PANEL_HEIGHT : 0;
  return {
    x: xOffset + (viewport.w - xOffset) / 2 - point.x * scale,
    y: (viewport.h - yOffset) / 2 - point.y * scale,
    scale,
  };
}

const DEFAULT_VIEWPORT = { w: 1440, h: 900 };

export function isInitialViewport(
  s: Pick<StickerRecord, "x" | "y" | "width" | "height">,
  view: { w: number; h: number } = DEFAULT_VIEWPORT
): boolean {
  const box = stickerBox(s);
  const viewLeft = CANVAS_HALF - view.w / 2;
  const viewTop = CANVAS_HALF - view.h / 2;
  return (
    box.left < viewLeft + view.w &&
    box.left + box.width > viewLeft &&
    box.top < viewTop + view.h &&
    box.top + box.height > viewTop
  );
}
