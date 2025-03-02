"use client";

import {
  PANEL_WIDTH,
  PANEL_BREAKPOINT,
  PANEL_HEIGHT,
} from "../components/Panel";

export function convertToCanvasCoordinates(x: number, y: number, scale: number) {
  const isMobile = window.innerWidth <= PANEL_BREAKPOINT;
  const xOffset = isMobile ? 0 : PANEL_WIDTH;
  const yOffset = isMobile ? PANEL_HEIGHT : 0;
  return {
    x: xOffset + (window.innerWidth - xOffset) / 2 - x * scale,
    y: (window.innerHeight - yOffset) / 2 - y * scale,
  };
}
