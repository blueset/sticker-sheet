// How the canvas layer's `will-change: transform` follows a gesture. The
// strategies only write `layer.style.willChange`; the controller decides when
// they run (gesture start, each transform write, 100 ms after the last one).
import type { Transform } from "../lib/geometry";

export interface SettleCtx {
  root: HTMLElement;
  layer: HTMLElement;
  transform: Transform;
}

export interface SettleStrategy {
  name: string;
  onGestureStart(c: SettleCtx): void;
  onChange?(c: SettleCtx): void;
  onSettle(c: SettleCtx): void;
}

export type SettleName = "drop-will-change" | "retoggle-on-scale-change" | "none";

const dropWillChange: SettleStrategy = {
  name: "drop-will-change",
  onGestureStart: (c) => {
    c.layer.style.willChange = "transform";
  },
  onSettle: (c) => {
    c.layer.style.willChange = "";
  },
};

// Keeps the promoted layer through pan-only gestures: the raster at rest is
// still valid, so it is dropped (and re-rastered) only when the scale changed.
// The baseline scale is the first transform seen, i.e. the one the page
// started a gesture from.
function retoggleOnScaleChange(): SettleStrategy {
  let rastered: number | null = null;
  return {
    name: "retoggle-on-scale-change",
    onGestureStart: (c) => {
      rastered ??= c.transform.scale;
      c.layer.style.willChange = "transform";
    },
    onSettle: (c) => {
      if (rastered !== null && c.transform.scale !== rastered) c.layer.style.willChange = "";
      rastered = c.transform.scale;
    },
  };
}

const none: SettleStrategy = {
  name: "none",
  onGestureStart: () => {},
  onSettle: () => {},
};

// Fresh state per call; tests and the page each take their own.
export function createSettleStrategies(): Record<SettleName, SettleStrategy> {
  return {
    "drop-will-change": dropWillChange,
    "retoggle-on-scale-change": retoggleOnScaleChange(),
    none,
  };
}

export const settleStrategies = createSettleStrategies();
