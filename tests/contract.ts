export type Target = "baseline" | "new";

export interface Contract {
  viewer: string;
  layer: string;
  stickers: string;
  sheetHandle: string;
  controls: {
    zoomIn: string;
    zoomOut: string;
    center: string;
    theme: string;
    language: string;
  };
}

// Baseline (unchanged Next.js app) selectors, confirmed against the served
// `out` build. `div.absolute.bottom-4.right-4` has no distinguishing
// attributes per control, so controls are addressed structurally: theme
// trigger, language trigger, a `span` holding zoom-in then zoom-out, centre.
const baselineContract: Contract = {
  viewer: "#canvasWrapper",
  layer: "#canvasWrapper > .react-transform-component",
  stickers: "#canvasWrapper button.absolute",
  sheetHandle: '[aria-label="Toggle panel size"]',
  controls: {
    theme: "div.absolute.bottom-4.right-4 > button:nth-child(1)",
    language: "div.absolute.bottom-4.right-4 > button:nth-child(2)",
    zoomIn: "div.absolute.bottom-4.right-4 > span > button:nth-child(1)",
    zoomOut: "div.absolute.bottom-4.right-4 > span > button:nth-child(2)",
    center: "div.absolute.bottom-4.right-4 > button:nth-child(4)",
  },
};

// New-app selectors (rewritten viewer), to be matched as the rewrite lands.
const newContract: Contract = {
  viewer: "#canvasWrapper",
  layer: "#canvas",
  stickers: "button.sticker[data-slug]",
  sheetHandle: '[aria-label="Toggle panel size"]',
  controls: {
    zoomIn: '[aria-label="Zoom in"]',
    zoomOut: '[aria-label="Zoom out"]',
    center: '[aria-label="Center view"]',
    theme: '[aria-label="Toggle theme"]',
    language: '[aria-label="Change language"]',
  },
};

export const target: Target = (process.env.TARGET as Target) ?? "new";

export const contract: Contract =
  target === "baseline" ? baselineContract : newContract;
