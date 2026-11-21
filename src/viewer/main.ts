// The eager entry: the saved theme's live `prefers-color-scheme` tracking,
// pan and zoom for the prerendered canvas, and the static zoom buttons.
import { appStore } from "../lib/appState";
import { applyTheme } from "../lib/theme";
import { createController } from "./controller";

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
}
