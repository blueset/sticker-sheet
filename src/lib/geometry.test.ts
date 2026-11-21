import { expect, test } from "vitest";
import placement from "../../tests/fixtures/placement.json";
import { loadStickers } from "./stickers";
import {
  isInitialViewport,
  PANEL_BREAKPOINT,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  SHEET_EXPANDED,
  SHEET_PEEK_PX,
  stickerBox,
  stickerCenter,
  viewTransformFor,
} from "./geometry";

test("panel and sheet constants match the baseline component", () => {
  expect(PANEL_HEIGHT).toBe(135);
  expect(PANEL_WIDTH).toBe(320);
  expect(PANEL_BREAKPOINT).toBe(4096);
  expect(SHEET_PEEK_PX).toBe(231);
  expect(SHEET_EXPANDED).toBe("calc(100dvh - 3em)");
});

test("stickerBox centers the sticker box on the canvas centre", () => {
  expect(stickerBox({ x: 225, y: -290, width: 180, height: 50 })).toEqual({
    left: 1635,
    top: 1185,
    width: 180,
    height: 50,
  });
});

test("stickerCenter offsets by the canvas half-width/height", () => {
  expect(stickerCenter({ x: 225, y: -290 })).toEqual({ x: 1725, y: 1210 });
});

test("viewTransformFor centers a narrow (mobile) viewport, offsetting for the bottom sheet peek", () => {
  expect(viewTransformFor({ x: 1500, y: 1500 }, 1, { w: 390, h: 844 })).toEqual({
    x: -1305,
    y: -1145.5,
    scale: 1,
  });
});

test("viewTransformFor centers a wide (desktop) viewport, offsetting for the left panel", () => {
  expect(viewTransformFor({ x: 1500, y: 1500 }, 2, { w: 5000, h: 1000 })).toEqual({
    x: -340,
    y: -2500,
    scale: 2,
  });
});

test("viewTransformFor treats exactly PANEL_BREAKPOINT as narrow", () => {
  expect(viewTransformFor({ x: 0, y: 0 }, 1, { w: 4096, h: 800 }).y).toBe((800 - 135) / 2);
});

test("viewTransformFor treats PANEL_BREAKPOINT + 1 as wide", () => {
  expect(viewTransformFor({ x: 0, y: 0 }, 1, { w: 4097, h: 800 }).x).toBe(320 + (4097 - 320) / 2);
});

test("isInitialViewport is true when the sticker box intersects the default 1440x900 viewport", () => {
  expect(isInitialViewport({ x: 225, y: -290, width: 180, height: 50 })).toBe(true);
});

test("isInitialViewport is false when the sticker box falls outside the default viewport", () => {
  expect(isInitialViewport({ x: 1400, y: 0, width: 100, height: 100 })).toBe(false);
});

test("stickerBox matches the baseline placement fixture within 1px for every sticker", () => {
  const stickers = loadStickers();
  const fixture = placement as Record<
    string,
    { left: number; top: number; width: number; height: number; rotate: string }
  >;
  expect(stickers.length).toBeGreaterThan(0);
  for (const sticker of stickers) {
    const expected = fixture[sticker.slug];
    expect(expected, `missing placement fixture for slug "${sticker.slug}"`).toBeDefined();
    const box = stickerBox(sticker);
    // Exact equality doesn't hold for every sticker (half-pixel centres on
    // odd width/height), so this allows up to 1px of drift, matching the
    // "within 1 px of the baseline" constraint.
    for (const key of ["left", "top", "width", "height"] as const) {
      expect(
        Math.abs(box[key] - expected[key]),
        `${key} mismatch for slug "${sticker.slug}": got ${box[key]}, expected ${expected[key]}`
      ).toBeLessThanOrEqual(1);
    }
  }
});
