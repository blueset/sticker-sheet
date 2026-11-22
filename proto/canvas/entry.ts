// Pathway B prototype entry, injected into a copy of Pathway A's build by
// proto/build.mjs. It attaches through the app's test seams (`window.__viewer`
// and `window.__app`), waiting for them if the eager entry has not run yet.
import { createRenderer, type Renderer } from "./render";

declare global {
  interface Window {
    __proto?: Renderer;
  }
}

function whenReady(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (window.__viewer && window.__app) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

void whenReady().then(() => {
  const root = document.getElementById("canvasWrapper");
  const layer = document.getElementById("canvas");
  if (!root || !layer || !window.__viewer) return;
  window.__proto = createRenderer(root, layer, window.__viewer);
});
