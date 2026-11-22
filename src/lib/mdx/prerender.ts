import { runSync, type RunOptions } from "@mdx-js/mdx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import type { Lang } from "../localize";
import { loadStickers } from "../stickers";
import { compileMdxToFunctionBody } from "./compile";
import { useMDXComponents } from "./provider";

export type LiveKind = "static" | "date" | "interactive";

export interface Prerendered {
  // Static markup; every `data-live` node in it has a matching entry in `exprs`.
  html: string;
  kind: LiveKind;
  // Plain-JS source of each `data-live="i"` expression, for the page's table.
  exprs: string[];
}

export interface StickerLabel {
  slug: string;
  lang: string;
}

// Far apart in year, month and day, so any date-derived text differs.
const EARLY = Date.parse("2020-01-01T00:00:00Z");
const LATE = Date.parse("2031-12-31T23:59:59Z");

const HOOK_CALL = /\buse[A-Z]\w*\s*\(/;
const LIVE_SPAN_TEXT = /(<span data-live="\d+">)[^<]*(<\/span>)/g;

// Runs `run` with `new Date()` and `Date.now()` pinned to `instant`; explicit
// arguments, `Date.UTC` and `Date.parse` behave normally. It is synchronous so
// the real `Date` is restored before anything else can run.
function withFixedDate<T>(instant: number, run: () => T): T {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(instant);
      else super(...(args as [number]));
    }

    static now(): number {
      return instant;
    }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = RealDate;
  }
}

// Evaluating the module is inside the window too: `export const y = new Date()…`
// runs at module evaluation, not at render.
function renderAt(instant: number, code: string): string {
  return withFixedDate(instant, () => {
    const { default: Content } = runSync(code, {
      ...runtime,
      useMDXComponents: useMDXComponents as unknown as RunOptions["useMDXComponents"],
    });
    return renderToStaticMarkup(createElement(Content));
  });
}

async function classify(source: string): Promise<Prerendered> {
  const marked = await compileMdxToFunctionBody(source, { markLive: true });
  const early = renderAt(EARLY, marked.code);
  if (HOOK_CALL.test(source)) return { html: early, kind: "interactive", exprs: marked.liveExprs };

  const late = renderAt(LATE, marked.code);
  if (early.replace(LIVE_SPAN_TEXT, "$1$2") !== late.replace(LIVE_SPAN_TEXT, "$1$2")) {
    throw new Error(
      "its output depends on the date in a way that cannot be made live. " +
        "Put every use of the date in a plain {…} expression, such as {new Date().getFullYear()}, " +
        "so the browser can re-evaluate it (not in an attribute, an export or a helper function).",
    );
  }
  if (early !== late) return { html: early, kind: "date", exprs: marked.liveExprs };
  if (marked.liveExprs.length === 0) return { html: early, kind: "static", exprs: [] };

  // The expressions mention `Date` but do not depend on the current date
  // (`new Date(2000, 0, 1)`): render them plainly rather than wait for a fill.
  const plain = await compileMdxToFunctionBody(source);
  return { html: renderAt(EARLY, plain.code), kind: "static", exprs: [] };
}

// The single evaluation path. `label` only names the sticker in errors.
export async function prerenderContentFrom(mdxSource: string, label?: StickerLabel): Promise<Prerendered> {
  try {
    return await classify(mdxSource);
  } catch (e) {
    const what = label ? `the content of sticker "${label.slug}" (${label.lang})` : "sticker content";
    throw new Error(`Cannot prerender ${what}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

export async function prerenderContent(slug: string, lang: Lang): Promise<Prerendered> {
  const sticker = loadStickers().find((s) => s.slug === slug);
  const source = sticker?.content?.[lang];
  if (!source) {
    const why = sticker ? `it has no content for ${lang}` : "there is no such sticker";
    throw new Error(`Cannot prerender the content of sticker "${slug}" (${lang}): ${why}.`);
  }
  const result = await prerenderContentFrom(source, { slug, lang });
  assertInteractiveAllowed(result.kind, sticker.width, sticker.height, { slug, lang });
  return result;
}

// No hydration runtime exists, so a visible hook/timer sticker would ship a frozen value.
// Zero-area stickers (hidden fixtures) are exempt; a missing/non-numeric size counts as 0.
export function assertInteractiveAllowed(kind: LiveKind, width: number, height: number, label: StickerLabel): void {
  if (kind !== "interactive") return;
  if ((Number(width) || 0) * (Number(height) || 0) > 0) {
    throw new Error(
      `Cannot prerender the content of sticker "${label.slug}" (${label.lang}): it uses a React hook or timer, which is not hydrated, so its value would be frozen at build time. Remove the hook, or make the sticker 0×0 if it is a hidden fixture.`,
    );
  }
}
