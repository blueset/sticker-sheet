import { describe, expect, it } from "vitest";
import { createCull } from "./cull";
import { createSettleStrategies, type SettleCtx } from "./settle";
import { applyVariants, parseVariants } from "./variants";

const ctx = (scale: number, layer = document.createElement("div")): SettleCtx => ({
  root: document.createElement("div"),
  layer,
  transform: { x: 0, y: 0, scale },
});

describe("settle strategies", () => {
  it("drop-will-change sets at gesture start and clears at settle", () => {
    const s = createSettleStrategies()["drop-will-change"];
    const c = ctx(1);
    s.onGestureStart(c);
    expect(c.layer.style.willChange).toBe("transform");
    s.onSettle(c);
    expect(c.layer.style.willChange).toBe("");
  });

  it("none never sets will-change", () => {
    const s = createSettleStrategies().none;
    const c = ctx(1);
    s.onGestureStart(c);
    expect(c.layer.style.willChange).toBe("");
    s.onSettle(c);
    expect(c.layer.style.willChange).toBe("");
  });

  it("retoggle-on-scale-change keeps will-change through pan-only gestures, repeatedly", () => {
    const s = createSettleStrategies()["retoggle-on-scale-change"];
    const layer = document.createElement("div");
    for (let i = 0; i < 3; i++) {
      s.onGestureStart(ctx(1, layer));
      expect(layer.style.willChange).toBe("transform");
      s.onSettle(ctx(1, layer));
      expect(layer.style.willChange).toBe("transform");
    }
  });

  it("retoggle-on-scale-change clears on a scale change, then treats the new scale as rastered", () => {
    const s = createSettleStrategies()["retoggle-on-scale-change"];
    const layer = document.createElement("div");
    s.onGestureStart(ctx(1, layer));
    s.onSettle(ctx(2, layer));
    expect(layer.style.willChange).toBe("");
    s.onGestureStart(ctx(2, layer));
    expect(layer.style.willChange).toBe("transform");
    s.onSettle(ctx(2, layer));
    expect(layer.style.willChange).toBe("transform");
  });
  it("retoggle-on-scale-change seeded with the initial scale clears on a first, non-zoom-first settle", () => {
    const s = createSettleStrategies(1)["retoggle-on-scale-change"];
    const layer = document.createElement("div");
    s.onGestureStart(ctx(1.5, layer));
    s.onSettle(ctx(2, layer));
    expect(layer.style.willChange).toBe("");
  });
});

describe("variants", () => {
  it("defaults when absent, empty or garbled", () => {
    const d = { shadow: "s0", settle: "drop-will-change", cull: "cv", bg: "png" };
    for (const q of ["", "?", "?v=", "?v=,,:,x", "?v=%E0%A4%A", "?other=1"]) expect(parseVariants(q)).toEqual(d);
  });

  it("parses known factors and ignores unknown factors and values", () => {
    expect(parseVariants("?v=settle:none,cull:explicit,bg:gradient,shadow:s0")).toEqual({
      shadow: "s0",
      settle: "none",
      cull: "explicit",
      bg: "gradient",
    });
    expect(parseVariants("?v=settle:bogus,nope:x,__proto__:y,bg:gradient").bg).toBe("gradient");
    expect(parseVariants("?v=settle:bogus,nope:x,__proto__:y").settle).toBe("drop-will-change");
  });

  it("last repeated factor wins", () => {
    expect(parseVariants("?v=bg:gradient,bg:png").bg).toBe("png");
  });

  it("applyVariants sets data-v-* attributes idempotently", () => {
    const el = document.createElement("html");
    applyVariants(el, "?v=cull:none");
    applyVariants(el, "?v=cull:none");
    expect(el.getAttribute("data-v-cull")).toBe("none");
    expect(el.getAttribute("data-v-bg")).toBe("png");
  });
});

describe("explicit cull", () => {
  it("marks stickers outside the viewport at settle and clears at gesture start", () => {
    const root = document.createElement("div");
    root.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    const layer = document.createElement("div");
    const mk = (x: number) => {
      const el = document.createElement("button");
      el.className = "sticker";
      el.getBoundingClientRect = () => new DOMRect(x, 0, 10, 10);
      layer.append(el);
      return el;
    };
    const inside = mk(50);
    const outside = mk(500);
    const cull = createCull(root, layer);
    cull.onSettle();
    expect(inside.hasAttribute("data-cull")).toBe(false);
    expect(outside.hasAttribute("data-cull")).toBe(true);
    cull.onGestureStart();
    expect(outside.hasAttribute("data-cull")).toBe(false);
  });
});
