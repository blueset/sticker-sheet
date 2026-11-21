// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaders = { dark: { en: vi.fn(), ja: vi.fn() }, eana: { en: vi.fn() } };
const manifest = vi.fn(() => ({ description: loaders, content: {} }));

async function load() {
  vi.resetModules();
  vi.doMock("virtual:sticker-mdx", manifest);
  return import("./prefetch");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function sticker(slug: string, cx: number, cy: number, w: number, h: number): string {
  return `<button class="sticker" data-slug="${slug}" data-cx="${cx}" data-cy="${cy}" style="width:${w}px;height:${h}px"></button>`;
}

beforeEach(() => {
  for (const group of Object.values(loaders)) for (const fn of Object.values(group)) fn.mockReset().mockResolvedValue({});
  manifest.mockClear();
});

afterEach(() => {
  vi.doUnmock("virtual:sticker-mdx");
  vi.unstubAllGlobals();
});

describe("prefetchDescription", () => {
  it("loads the manifest and a chunk once per slug and language", async () => {
    const { prefetchDescription } = await load();
    prefetchDescription("dark", "en");
    prefetchDescription("dark", "en");
    await flush();
    prefetchDescription("dark", "en");
    prefetchDescription("dark", "ja");
    prefetchDescription("eana", "en");
    await flush();
    expect(manifest).toHaveBeenCalledTimes(1);
    expect(loaders.dark.en).toHaveBeenCalledTimes(1);
    expect(loaders.dark.ja).toHaveBeenCalledTimes(1);
    expect(loaders.eana.en).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed chunk and never rejects", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    loaders.dark.en.mockRejectedValue(new Error("offline"));
    const { prefetchDescription } = await load();
    prefetchDescription("dark", "en");
    await flush();
    prefetchDescription("dark", "en");
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(loaders.dark.en).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("ignores an unknown slug or a language the sticker lacks", async () => {
    const { prefetchDescription } = await load();
    prefetchDescription("nope", "en");
    prefetchDescription("eana", "ja");
    await flush();
    expect(manifest).toHaveBeenCalledTimes(1);
    for (const group of Object.values(loaders)) for (const fn of Object.values(group)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("visibleSlugs", () => {
  it("keeps the stickers whose boxes meet the first view, from inline geometry", async () => {
    const { visibleSlugs } = await load();
    document.body.innerHTML = [
      sticker("near", 1500, 1500, 200, 200),
      sticker("edge", 2239, 1500, 200, 200),
      sticker("just-out", 2340, 1500, 200, 200),
      sticker("far", 965, 2300, 145, 141),
      sticker("flat", 1500, 1500, 0, 0),
    ].join("");
    expect(visibleSlugs(document.body, { w: 1280, h: 800 })).toEqual(["near", "edge"]);
  });
});

describe("prefetchVisible", () => {
  const view = { w: 1280, h: 800 };

  beforeEach(() => {
    vi.stubGlobal("innerWidth", view.w);
    vi.stubGlobal("innerHeight", view.h);
    document.body.innerHTML = sticker("eana", 1500, 1500, 200, 200) + sticker("dark", 1285, 1260, 100, 100);
  });

  it("warms the deep-linked sticker first, then the visible ones", async () => {
    const order: string[] = [];
    loaders.dark.en.mockImplementation(async () => order.push("dark"));
    loaders.eana.en.mockImplementation(async () => order.push("eana"));
    const { prefetchVisible } = await load();
    prefetchVisible(document.body, "en", "dark");
    await flush();
    expect(order).toEqual(["dark", "eana"]);
  });

  it("does nothing when the user asked to save data", async () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const { prefetchVisible } = await load();
    prefetchVisible(document.body, "en", "dark");
    await flush();
    expect(manifest).not.toHaveBeenCalled();
  });
});

describe("whenIdle", () => {
  it("falls back to a timer without requestIdleCallback", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const { whenIdle } = await load();
    const fn = vi.fn();
    whenIdle(fn);
    vi.advanceTimersByTime(1999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
