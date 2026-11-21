import { viewTransformFor, type Transform } from "../lib/geometry";

declare global {
  interface Window {
    __boot?: Transform;
    // The viewport `__boot` was computed for, so the viewer can tell whether
    // it changed before it started.
    __bootViewport?: { w: number; h: number };
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

try {
  if (canvas) {
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const center = hashedCenter();
    const view: Transform = center
      ? viewTransformFor(center, 1, viewport)
      : { x: (viewport.w - CANVAS_SIZE) / 2, y: (viewport.h - CANVAS_SIZE) / 2, scale: 1 };

    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(1)`;
    window.__boot = view;
    window.__bootViewport = viewport;
  }
} finally {
  // Lifts boot-head's deep-link gate in every path, including unknown slugs.
  document.documentElement.removeAttribute("data-deep");
}

// Date-dependent expressions are prerendered as hidden `[data-live]` nodes; the
// page's CSS keeps each hidden until it is filled, so no stale value ever paints.
function fillLive(): void {
  let table: Record<string, Record<string, string[]>> | null = null;
  try {
    table = JSON.parse(document.getElementById("live-exprs")?.textContent ?? "");
  } catch {
    // A missing or malformed table leaves every live node hidden.
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-live]")) {
    const slug = node.closest<HTMLElement>("[data-slug]")?.dataset.slug;
    const lang = node.closest<HTMLElement>("[data-l]")?.dataset.l;
    const expr = slug && lang ? table?.[slug]?.[lang]?.[+node.dataset.live!] : undefined;
    if (typeof expr !== "string") continue;
    try {
      node.textContent = String(new Function(`return(${expr})`)());
      node.dataset.filled = "";
    } catch {
      // This node stays hidden; the others still fill.
    }
  }
}

fillLive();
