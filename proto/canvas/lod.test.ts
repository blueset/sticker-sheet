import { describe, expect, it } from "vitest";
import { ByteLru, Generations, Trickle, lodCullable, lodLevel, nearestLevel, resolveScheme, snapScale } from "./lod";

describe("Trickle (deferred base-LOD prefetch)", () => {
  it("hands out one item per call, in order, for the current run", () => {
    const t = new Trickle<string>();
    const run = t.start(["a", "b"]);
    expect(t.pending).toBe(2);
    expect(t.next(run)).toBe("a");
    expect(t.next(run)).toBe("b");
    expect(t.next(run)).toBeUndefined();
  });
  it("gives a superseded or stopped run nothing", () => {
    const t = new Trickle<string>();
    const first = t.start(["a", "b"]);
    const second = t.start(["c"]);
    expect(t.next(first)).toBeUndefined();
    expect(t.next(second)).toBe("c");
    const third = t.start(["d"]);
    t.stop();
    expect(t.pending).toBe(0);
    expect(t.next(third)).toBeUndefined();
  });
});

describe("Generations (store acceptance)", () => {
  it("accepts a job stamped in the current generation", () => {
    const g = new Generations();
    expect(g.fresh(g.stamp())).toBe(true);
    expect(g.fresh(g.stamp(true))).toBe(true);
  });
  it("rejects every job stamped before a clear", () => {
    const g = new Generations();
    const lod = g.stamp();
    const exact = g.stamp(true);
    g.bumpClear();
    expect(g.fresh(lod)).toBe(false);
    expect(g.fresh(exact)).toBe(false);
    expect(g.fresh(g.stamp(true))).toBe(true);
  });
  it("rejects only exact jobs after an exact drop", () => {
    const g = new Generations();
    const lod = g.stamp();
    const exact = g.stamp(true);
    g.bumpExact();
    expect(g.fresh(lod)).toBe(true);
    expect(g.fresh(exact)).toBe(false);
  });
});

describe("lodCullable", () => {
  const vis = new Set(["a"]);
  it("drops high levels of off-screen stickers only", () => {
    expect(lodCullable("b|/b.svg@8", vis)).toBe(true);
    expect(lodCullable("b|/b.svg@2", vis)).toBe(false);
    expect(lodCullable("a|/a.svg@8", vis)).toBe(false);
    expect(lodCullable("b|/b.svg@exact", vis)).toBe(false);
  });
});

describe("resolveScheme", () => {
  const svg = "<style>.s{fill:#fff}@media (prefers-color-scheme:light){.s{fill:#000}}</style>";
  it("keeps the rule for the page scheme and disables the other", () => {
    expect(resolveScheme(svg, false)).toContain("@media all{");
    expect(resolveScheme(svg, true)).toContain("@media not all{");
    expect(resolveScheme("@media ( prefers-color-scheme : dark ){}", true)).toBe("@media all{}");
  });
});

describe("snapScale", () => {
  it("snaps up to a power of two within [0.125, 8]", () => {
    expect(snapScale(0.7)).toBe(1);
    expect(snapScale(1)).toBe(1);
    expect(snapScale(1.01)).toBe(2);
    expect(snapScale(0.01)).toBe(0.125);
    expect(snapScale(50)).toBe(8);
  });
});

describe("lodLevel", () => {
  it("is snapScale while the bitmap fits the side cap", () => {
    expect(lodLevel(3, 200, 100, 2048)).toBe(4);
  });
  it("halves the level until the longest side fits", () => {
    // 300 px at 8 would be 2400 px: 4 gives 1200.
    expect(lodLevel(10, 300, 120, 2048)).toBe(4);
    expect(lodLevel(10, 4000, 10, 2048)).toBe(0.5);
  });
});

describe("nearestLevel", () => {
  it("prefers the wanted level, then the closest higher, then the closest lower", () => {
    expect(nearestLevel([1, 2, 4], 2)).toBe(2);
    expect(nearestLevel([0.5, 4, 8], 2)).toBe(4);
    expect(nearestLevel([0.25, 0.5], 2)).toBe(0.5);
    expect(nearestLevel([], 2)).toBeNull();
  });
});

describe("ByteLru", () => {
  it("accounts bytes and evicts least recently used entries past the cap", () => {
    const evicted: string[] = [];
    const lru = new ByteLru<string>(100, (key) => evicted.push(key));
    lru.set("a", "A", 40);
    lru.set("b", "B", 40);
    expect(lru.get("a")).toBe("A"); // a is now most recent
    lru.set("c", "C", 40);
    expect(evicted).toEqual(["b"]);
    expect(lru.bytes).toBe(80);
    expect(lru.size).toBe(2);
    expect(lru.peakBytes).toBe(80);
  });

  it("replacing a key releases the old value and its bytes", () => {
    const evicted: string[] = [];
    const lru = new ByteLru<string>(100, (key, value) => evicted.push(`${key}=${value}`));
    lru.set("a", "A1", 30);
    lru.set("a", "A2", 50);
    expect(evicted).toEqual(["a=A1"]);
    expect(lru.bytes).toBe(50);
    lru.delete("a");
    expect(evicted).toEqual(["a=A1", "a=A2"]);
    expect(lru.bytes).toBe(0);
    expect(lru.peakBytes).toBe(50);
  });

  it("counts hits and misses on get, not on peek", () => {
    const lru = new ByteLru<number>(10);
    lru.set("x", 1, 1);
    lru.get("x");
    lru.get("y");
    lru.peek("x");
    lru.peek("y");
    expect([lru.hits, lru.misses]).toEqual([1, 1]);
  });

  it("refuses an entry larger than the cap without evicting others", () => {
    const evicted: string[] = [];
    const lru = new ByteLru<string>(100, (key) => evicted.push(key));
    lru.set("a", "A", 60);
    expect(lru.set("big", "B", 101)).toBe(false);
    expect(evicted).toEqual(["big"]);
    expect(lru.peek("a")).toBe("A");
    expect(lru.bytes).toBe(60);
  });

  it("deleteWhere drops matching entries", () => {
    const lru = new ByteLru<string>(100);
    lru.set("a@1", "A", 10);
    lru.set("a@exact", "E", 10);
    lru.set("b@exact", "F", 10);
    lru.deleteWhere((key) => key.endsWith("@exact"));
    expect([...lru.keys()]).toEqual(["a@1"]);
    expect(lru.bytes).toBe(10);
  });
});
