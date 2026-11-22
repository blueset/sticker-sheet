// Dev-only placement editor (`astro dev`; injected by ./integration.ts). Port of
// the old Next app's DebugTools: a Tweakpane pane that edits the selected
// sticker's left/top/width/height/rotate on the live DOM and prints the YAML
// fields (src/data/stickers/<slug>.yaml) to copy. No store: the DOM is the state.
import type { BindingApi } from "@tweakpane/core";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import { useEffect } from "react";
import { Pane } from "tweakpane";

// The YAML's x/y are the sticker centre relative to the 3000×3000 canvas
// centre; Sticker.astro (via lib/geometry `stickerBox`) renders
// left = x + CANVAS_HALF − width/2, top = y + CANVAS_HALF − height/2.
const CANVAS_HALF = 1500;
const NUDGE = 5;

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

function stickerElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#canvas button.sticker[data-slug]")];
}

function elementFor(slug: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#canvas button.sticker[data-slug="${CSS.escape(slug)}"]`);
}

function readPlacement(el: HTMLElement): Placement {
  const left = parseFloat(el.style.left) || 0;
  const top = parseFloat(el.style.top) || 0;
  const width = parseFloat(el.style.width) || 0;
  const height = parseFloat(el.style.height) || 0;
  return {
    x: left + width / 2 - CANVAS_HALF,
    y: top + height / 2 - CANVAS_HALF,
    width,
    height,
    rotation: parseFloat(el.style.rotate) || 0,
  };
}

function writePlacement(el: HTMLElement, p: Placement): void {
  const cx = p.x + CANVAS_HALF;
  const cy = p.y + CANVAS_HALF;
  el.style.left = `${cx - p.width / 2}px`;
  el.style.top = `${cy - p.height / 2}px`;
  el.style.width = `${p.width}px`;
  el.style.height = `${p.height}px`;
  el.style.rotate = p.rotation ? `${p.rotation}deg` : "";
  el.style.containIntrinsicSize = `${p.width}px ${p.height}px`;
  // The viewer centres a selected sticker on data-cx/data-cy.
  el.dataset.cx = String(cx);
  el.dataset.cy = String(cy);
}

const round = (n: number) => Math.round(n * 100) / 100;

function toYaml(p: Placement): string {
  return [
    `x: ${round(p.x)}`,
    `y: ${round(p.y)}`,
    `width: ${round(p.width)}`,
    `height: ${round(p.height)}`,
    `rotation: ${round(p.rotation)}`,
  ].join("\n");
}

function titleOf(el: HTMLElement): string {
  try {
    const titles = JSON.parse(el.dataset.titles ?? "{}") as Record<string, string>;
    return titles.en ?? Object.values(titles)[0] ?? el.dataset.slug!;
  } catch {
    return el.dataset.slug!;
  }
}

export default function PlacementEditor() {
  useEffect(() => {
    const elements = stickerElements();
    if (!elements.length) return;

    const first = readPlacement(elements[0]);
    const params = {
      slug: elements[0].dataset.slug!,
      rotation: first.rotation,
      coords: { x: first.x, y: first.y },
      width: first.width,
      height: first.height,
      yaml: toYaml(first),
    };

    const container = document.createElement("div");
    container.dataset.devPlacementEditor = "";
    container.style.cssText = "position:fixed;top:8px;right:8px;width:280px;z-index:2147483647;";
    document.body.append(container);

    const pane = new Pane({ title: "Canvas", container });
    pane.registerPlugin(EssentialsPlugin);
    pane.addButton({ title: "SVG → CSS shape" }).on("click", () => {
      window.open("/dev/svg-shape", "_blank", "noopener,noreferrer");
    });
    const slugBinding = pane.addBinding(params, "slug", {
      label: "sticker",
      options: Object.fromEntries(elements.map((el) => [`${titleOf(el)} (${el.dataset.slug})`, el.dataset.slug!])),
    });
    const rotationBinding = pane.addBinding(params, "rotation", { min: -360, max: 360, step: 5 });
    const coordsBinding = pane.addBinding(params, "coords", {
      x: { min: -1000, max: 1000, step: 5 },
      y: { min: -1000, max: 1000, step: 5 },
    });
    const widthBinding = pane.addBinding(params, "width");
    const heightBinding = pane.addBinding(params, "height");
    const yamlBinding = pane.addBinding(params, "yaml", { readonly: true, multiline: true, rows: 5, interval: 0 });
    pane.addButton({ title: "Copy YAML" }).on("click", () => {
      console.info(`[placement] ${params.slug}\n${params.yaml}`);
      navigator.clipboard?.writeText(params.yaml).catch(() => {});
    });
    const fpsBlade = pane.addBlade({ view: "fpsgraph", label: "FPS", rows: 2 }) as EssentialsPlugin.FpsGraphBladeApi;

    // Programmatic refreshes must not write back to the DOM (step/min/max
    // constraints could otherwise move a sticker nobody touched).
    let syncing = false;
    const controls: BindingApi[] = [rotationBinding, coordsBinding, widthBinding, heightBinding];

    function quietly(fn: () => void) {
      syncing = true;
      try {
        fn();
      } finally {
        syncing = false;
      }
    }

    function showYaml(p: Placement) {
      params.yaml = toYaml(p);
      yamlBinding.refresh();
    }

    function loadSelected() {
      const el = elementFor(params.slug);
      if (!el) return;
      const p = readPlacement(el);
      Object.assign(params, { rotation: p.rotation, coords: { x: p.x, y: p.y }, width: p.width, height: p.height });
      quietly(() => controls.forEach((binding) => binding.refresh()));
      showYaml(p);
      console.info(`[placement] ${params.slug}\n${params.yaml}`);
    }

    function apply() {
      const el = elementFor(params.slug);
      if (!el) return;
      const p = {
        x: params.coords.x,
        y: params.coords.y,
        width: params.width,
        height: params.height,
        rotation: params.rotation,
      };
      writePlacement(el, p);
      showYaml(p);
    }

    slugBinding.on("change", () => {
      if (!syncing) loadSelected();
    });
    for (const binding of controls) {
      binding.on("change", () => {
        if (!syncing) apply();
      });
    }

    const coordsButton = coordsBinding.element.querySelector("button");
    const nudges: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
    };
    const onCoordsKey = (ev: KeyboardEvent) => {
      const delta = nudges[ev.key];
      if (!delta || document.activeElement !== coordsButton) return;
      ev.preventDefault();
      params.coords = { x: params.coords.x + delta[0], y: params.coords.y + delta[1] };
      quietly(() => coordsBinding.refresh());
      apply();
    };
    coordsButton?.addEventListener("keydown", onCoordsKey);

    // Follow the app's selection with a cheap per-frame read of the test hook
    // (no listeners on the app's own elements or events).
    let lastAppSlug: string | null = null;
    let frame = 0;
    function tick() {
      fpsBlade.begin();
      fpsBlade.end();
      const appSlug = window.__app?.selectedSlug ?? null;
      if (appSlug !== lastAppSlug) {
        lastAppSlug = appSlug;
        if (appSlug && appSlug !== params.slug && elementFor(appSlug)) {
          params.slug = appSlug;
          quietly(() => slugBinding.refresh());
          loadSelected();
        }
      }
      frame = requestAnimationFrame(tick);
    }
    loadSelected();
    tick();

    return () => {
      cancelAnimationFrame(frame);
      coordsButton?.removeEventListener("keydown", onCoordsKey);
      pane.dispose();
      container.remove();
    };
  }, []);

  return null;
}
