// The eager entry: the saved theme's live `prefers-color-scheme` tracking,
// pan and zoom for the prerendered canvas, the static zoom buttons, and the
// sticker interactions (tooltip, selection, hash anchors, description prefetch).
import { appStore } from "../lib/appState";
import { applyTheme } from "../lib/theme";
import { createController } from "./controller";
// Runs before the controller is created: a `#slug` deep link starts the Sheet
// and description chunks now, not at idle.
import "./deeplink";
import { initInteractions } from "./interactions";
import { prefetchVisible, whenIdle } from "./prefetch";

declare global {
  interface Window {
    // For tests: what is selected. Read-only; selection goes through appStore.
    __app?: { readonly selectedSlug: string | null };
  }
}

const CANVAS_SIZE = 3000;
// rzpp zoomIn / zoomOut: scale by exp(±0.5) about the viewer's centre.
const BUTTON_STEP = 0.5;

// appState does not paint at import; a saved "system" theme needs its media
// listener attached here (boot-head painted the first frame already). First,
// so a viewer failure cannot leave the theme static.
applyTheme(appStore.getState().theme);

const root = document.getElementById("canvasWrapper");
const layer = document.getElementById("canvas");

if (root && layer) {
  const viewer = createController(root, layer, { content: { w: CANVAS_SIZE, h: CANVAS_SIZE } });
  document.addEventListener(
    "click",
    (e) => {
      const action = (e.target as Element | null)?.closest?.("[data-action]")?.getAttribute("data-action");
      if (action === "zoom-in") viewer.zoomBy(Math.exp(BUTTON_STEP));
      else if (action === "zoom-out") viewer.zoomBy(Math.exp(-BUTTON_STEP));
      else if (action === "center") viewer.center();
    },
    { passive: true },
  );

  const slugs = new Set<string>();
  for (const el of layer.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) slugs.add(el.dataset.slug!);
  initInteractions({ canvas: layer, controller: viewer, slugs });
  window.__app = {
    get selectedSlug() {
      return appStore.getState().selectedSlug;
    },
  };

  // After first paint, with the browser idle: warm the descriptions of the
  // stickers in view, in the saved language.
  whenIdle(() => prefetchVisible(layer, appStore.getState().language, appStore.getState().selectedSlug));
}
