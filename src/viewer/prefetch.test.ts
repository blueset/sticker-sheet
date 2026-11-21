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

  describe("bounded", () => {
    type Gate = { slug: string; release: () => void };
    const gates: Gate[] = [];
    let inFlight = 0;
    let peak = 0;
    const started: string[] = [];

    function gated(slugs: string[], fail = new Set<string>()) {
      const group: Record<string, Record<string, () => Promise<unknown>>> = {};
      for (const slug of slugs) {
        group[slug] = {
          en: () => {
            started.push(slug);
            peak = Math.max(peak, ++inFlight);
            return new Promise((resolve, reject) =>
              gates.push({
                slug,
                release: () => {
                  inFlight--;
                  if (fail.has(slug)) reject(new Error("offline"));
                  else resolve({});
                },
              }),
            );
          },
        };
      }
      manifest.mockReturnValue({ description: group, content: {} } as never);
    }

    beforeEach(() => {
      gates.length = 0;
      started.length = 0;
      inFlight = 0;
      peak = 0;
    });

    afterEach(() => {
      manifest.mockReturnValue({ description: loaders, content: {} });
    });

    const settleAll = async () => {
      for (let guard = 0; guard < 50; guard++) {
        await flush();
        const gate = gates.shift();
        if (!gate) return;
        gate.release();
      }
    };

    it("warms the selected slug, then the rest nearest the view centre first", async () => {
      // Distances from (1500,1500): s2=50, s1=100, s3=200, s0=300.
      const spec: [string, number][] = [["s0", 1800], ["s1", 1600], ["s2", 1450], ["s3", 1300]];
      document.body.innerHTML = spec.map(([slug, cx]) => sticker(slug, cx, 1500, 100, 100)).join("");
      gated(spec.map(([slug]) => slug));
      const { prefetchVisible } = await load();
      prefetchVisible(document.body, "en", "s0");
      await flush();
      await settleAll();
      expect(started).toEqual(["s0", "s2", "s1", "s3"]);
    });

    it("caps the idle pass at 12 and never has more than 3 in flight", async () => {
      const slugs = Array.from({ length: 30 }, (_, i) => `s${i}`);
      document.body.innerHTML = slugs.map((slug, i) => sticker(slug, 1500 + i * 5, 1500, 50, 50)).join("");
      gated(slugs);
      const { prefetchVisible } = await load();
      prefetchVisible(document.body, "en", null);
      await flush();
      expect(inFlight).toBe(3);
      await settleAll();
      expect(started).toEqual(slugs.slice(0, 12));
      expect(peak).toBe(3);
    });

    it("keeps going after a failed request", async () => {
      const slugs = ["a", "b", "c", "d", "e"];
      document.body.innerHTML = slugs.map((slug, i) => sticker(slug, 1500 + i * 10, 1500, 50, 50)).join("");
      gated(slugs, new Set(["a"]));
      const { prefetchVisible } = await load();
      prefetchVisible(document.body, "en", null);
      await flush();
      await settleAll();
      expect(started).toEqual(slugs);
    });

    it("does not re-request a slug the hover path already warmed", async () => {
      document.body.innerHTML = sticker("a", 1500, 1500, 50, 50);
      gated(["a"]);
      const { prefetchVisible, prefetchDescription } = await load();
      void prefetchDescription("a", "en");
      prefetchVisible(document.body, "en", "a");
      await flush();
      await settleAll();
      expect(started).toEqual(["a"]);
    });
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
