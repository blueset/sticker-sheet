// Warms a sticker's description chunk before the Sheet asks for it. The
// manifest is a dynamic import, so it and every description chunk stay out of
// the eager entry; nothing here may ever throw or log, since a failed
// prefetch costs only the warm-up.
import { isInitialViewport } from "../lib/geometry";
import type { Lang } from "../lib/localize";

const CANVAS_HALF = 1500;
// The first view can show nearly every sticker; warming all of them on each
// load costs battery and data. Bound the idle pass: hover/focus/click cover the rest.
const IDLE_MAX = 12;
const IDLE_CONCURRENCY = 3;

type Manifest = typeof import("virtual:sticker-mdx");

let manifest: Promise<Manifest> | undefined;
const requested = new Set<string>();

// Once per (slug, lang), failures included: a flaky network is not hammered
// by every hover, and the Sheet's own load is the retry that matters.
export function prefetchDescription(slug: string, lang: Lang): Promise<void> {
  const key = `${slug}\0${lang}`;
  if (requested.has(key)) return Promise.resolve();
  requested.add(key);
  manifest ??= import("virtual:sticker-mdx");
  return manifest.then((m) => m.description[slug]?.[lang]?.()).then(() => {}, () => {});
}

export function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 5000 });
  else setTimeout(fn, 2000);
}

const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

// Slugs whose boxes intersect the first view, read from the inline geometry
// (never `getBoundingClientRect`, which would force layout).
export function visibleSlugs(canvas: ParentNode, view: { w: number; h: number }): string[] {
  const slugs: string[] = [];
  for (const el of canvas.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
    const width = parseFloat(el.style.width);
    const height = parseFloat(el.style.height);
    const cx = Number(el.dataset.cx);
    const cy = Number(el.dataset.cy);
    if (!(width > 0 && height > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    if (isInitialViewport({ x: cx - CANVAS_HALF, y: cy - CANVAS_HALF, width, height }, view)) slugs.push(el.dataset.slug!);
  }
  return slugs;
}

// The idle pass: the deep-linked sticker first (the Sheet opens on it), then
// the visible ones nearest the view centre, capped and throttled. Skipped when
// the user asked to save data.
export function prefetchVisible(canvas: ParentNode, lang: Lang, selected: string | null): void {
  if (saveData()) return;
  const near = new Map<string, number>();
  for (const el of canvas.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
    near.set(el.dataset.slug!, Math.hypot(Number(el.dataset.cx) - CANVAS_HALF, Number(el.dataset.cy) - CANVAS_HALF));
  }
  const visible = visibleSlugs(canvas, { w: innerWidth, h: innerHeight }).sort((a, b) => near.get(a)! - near.get(b)!);
  const queue = [...new Set(selected ? [selected, ...visible] : visible)].slice(0, IDLE_MAX);
  const next = (): void => {
    const slug = queue.shift();
    if (slug) void prefetchDescription(slug, lang).then(next);
  };
  for (let i = 0; i < IDLE_CONCURRENCY; i++) next();
}
