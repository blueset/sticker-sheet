import { viewTransformFor, type Transform } from "../lib/geometry";

declare global {
  interface Window {
    __boot?: Transform;
  }
}

// Runs right after the canvas markup so the hashed sticker is centred before
// first paint. Mirrors the old `centerOnInit` when there is nothing to centre on.
const CANVAS_SIZE = 3000;

function hashedCenter(): { x: number; y: number } | null {
  try {
    const slug = decodeURIComponent(location.hash.slice(1));
    for (const el of document.querySelectorAll<HTMLElement>("[data-slug]")) {
      if (el.dataset.slug !== slug) continue;
      const x = +(el.dataset.cx || NaN);
      const y = +(el.dataset.cy || NaN);
      return isFinite(x) && isFinite(y) ? { x, y } : null;
    }
  } catch {
    // Malformed percent escapes fall through to the default view.
  }
  return null;
}

const canvas = document.getElementById("canvas");

if (canvas) {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const center = hashedCenter();
  const view: Transform = center
    ? viewTransformFor(center, 1, viewport)
    : { x: (viewport.w - CANVAS_SIZE) / 2, y: (viewport.h - CANVAS_SIZE) / 2, scale: 1 };

  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(1)`;
  window.__boot = view;
}
