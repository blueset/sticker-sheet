// Hover tooltip, click / keyboard selection and hash anchors for the
// prerendered stickers: delegated listeners on the canvas, no per-sticker
// handlers. There is no Sheet yet; selection lives in `appStore` and the URL
// hash, and the view re-centres on the selected sticker.
import { appStore, initFromHash, select } from "../lib/appState";
import { viewTransformFor } from "../lib/geometry";
import { localize } from "../lib/localize";
import type { Controller } from "./controller";
import { prefetchDescription } from "./prefetch";

const TIP_GAP = 10;

export interface InteractionContext {
  canvas: HTMLElement;
  controller: Pick<Controller, "transform" | "setTransform" | "onGestureStart" | "onSettle">;
  slugs: ReadonlySet<string>;
}

interface Point {
  x: number;
  y: number;
}

// The tooltip's left edge sits at the cursor and its bottom edge `gap` above
// it (the baseline's Radix side="top" align="start"), kept inside the viewport.
export function placeTip(cursor: Point, tip: { w: number; h: number }, view: { w: number; h: number }, gap = TIP_GAP): Point {
  return {
    x: Math.max(0, Math.min(cursor.x, view.w - tip.w)),
    y: Math.max(0, Math.min(cursor.y - gap - tip.h, view.h - tip.h)),
  };
}

function clipOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("button.sticker .clip") : null;
}

function stickerOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("button.sticker") : null;
}

function titleOf(clip: HTMLElement): string {
  try {
    const titles = JSON.parse(stickerOf(clip)?.dataset.titles ?? "null");
    return localize(titles ?? undefined, appStore.getState().language) ?? "";
  } catch {
    return "";
  }
}

export function initInteractions({ canvas, controller, slugs }: InteractionContext): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const buttons = new Map<string, HTMLElement>();
  for (const el of canvas.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) buttons.set(el.dataset.slug!, el);

  // ---- tooltip ----
  // Created on the first hover so it costs the prerendered page nothing, and
  // moved only by `transform` (one write per frame, never a layout read of the
  // canvas): its own size is measured when its text changes.
  const coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
  let tip: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let gesturing = false;
  let shownText = "";
  let size = { w: 0, h: 0 };
  let view: { w: number; h: number } | null = null;
  let pointer: Point = { x: 0, y: 0 };
  let frame = 0;

  const showing = () => tip !== null && !tip.hidden;

  function place(): void {
    if (!tip) return;
    view ??= { w: innerWidth, h: innerHeight };
    const at = placeTip(pointer, size, view);
    const transform = `translate(${at.x}px, ${at.y}px)`;
    if (tip.style.transform !== transform) tip.style.transform = transform;
  }

  function hide(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    shownText = "";
    if (tip) tip.hidden = true;
  }

  function render(): void {
    const text = hovered && !gesturing && !coarse?.matches ? titleOf(hovered) : "";
    if (!text) {
      hide();
      return;
    }
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "tip";
      tip.setAttribute("role", "tooltip");
      tip.hidden = true;
      document.body.append(tip);
    }
    if (text !== shownText || tip.hidden) {
      tip.textContent = text;
      shownText = text;
      tip.hidden = false;
      size = { w: tip.offsetWidth, h: tip.offsetHeight };
    }
    place();
  }

  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  }

  function hover(clip: HTMLElement | null): void {
    hovered = clip;
    const slug = clip && stickerOf(clip)?.dataset.slug;
    if (slug) prefetchDescription(slug, appStore.getState().language);
    render();
  }

  canvas.addEventListener(
    "mouseover",
    (e) => {
      const clip = clipOf(e.target);
      if (!clip) return;
      pointer = { x: e.clientX, y: e.clientY };
      hover(clip);
    },
    { signal },
  );

  canvas.addEventListener(
    "mouseout",
    (e) => {
      const from = clipOf(e.target);
      const to = clipOf(e.relatedTarget);
      if (from && from !== to) hover(to);
    },
    { signal },
  );

  // The hit target of a real pointer is authoritative, so a missed mouseout
  // cannot strand the tooltip, and a stationary pointer under a finished
  // gesture gets it back on its next move.
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      pointer = { x: e.clientX, y: e.clientY };
      const clip = clipOf(e.target);
      if (clip !== hovered || (clip && !showing())) hover(clip);
      else if (showing()) schedule();
    },
    { passive: true, signal },
  );

  window.addEventListener("resize", () => (view = null), { passive: true, signal });
  window.addEventListener(
    "blur",
    () => {
      hovered = null;
      hide();
    },
    { signal },
  );

  const offGestureStart = controller.onGestureStart(() => {
    gesturing = true;
    hide();
  });
  const offSettle = controller.onSettle(() => {
    gesturing = false;
  });
  const offStore = appStore.subscribe((state, prev) => {
    if (state.language !== prev.language && showing()) render();
  });

  // ---- selection ----
  function centre(slug: string): void {
    const el = buttons.get(slug);
    const x = Number(el?.dataset.cx);
    const y = Number(el?.dataset.cy);
    if (!el || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // The viewport boot-view centred a deep link in, so a later select agrees.
    controller.setTransform(viewTransformFor({ x, y }, controller.transform.scale, { w: innerWidth, h: innerHeight }));
  }

  canvas.addEventListener(
    "click",
    (e) => {
      const slug = stickerOf(e.target)?.dataset.slug;
      if (!slug || !slugs.has(slug)) return;
      // A mouse or tap counts only inside the clip-path; Enter and Space on a
      // focused button click with detail 0 and may target the button itself.
      if (e.detail !== 0 && !(e.target as Element).closest(".clip")) return;
      select(slug, { push: true });
      centre(slug);
    },
    { signal },
  );

  canvas.addEventListener(
    "focusin",
    (e) => {
      const slug = stickerOf(e.target)?.dataset.slug;
      if (slug) prefetchDescription(slug, appStore.getState().language);
    },
    { signal },
  );

  // ---- hash ----
  // The load already centred a deep link (boot-view, before first paint), so
  // this only selects. Back and forward fire popstate and hashchange for one
  // navigation; the second finds the selection unchanged and does nothing.
  initFromHash(slugs);
  function sync(): void {
    const before = appStore.getState().selectedSlug;
    initFromHash(slugs);
    const after = appStore.getState().selectedSlug;
    if (after !== null && after !== before) centre(after);
  }
  window.addEventListener("hashchange", sync, { signal });
  window.addEventListener("popstate", sync, { signal });

  return () => {
    abort.abort();
    offGestureStart();
    offSettle();
    offStore();
    hide();
    tip?.remove();
    tip = null;
  };
}
