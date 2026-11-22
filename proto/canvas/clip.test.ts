import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { clipToCommands } from "./clip";

const TAU = 2 * Math.PI;

describe("clipToCommands", () => {
  it("turns a circle into one full arc", () => {
    expect(clipToCommands("circle(50% at 50% 50%)", 100, 100)).toEqual([["A", 50, 50, 50, 50, 0, 0, TAU], ["Z"]]);
  });

  it("resolves polygon percentages against the sticker box", () => {
    expect(clipToCommands("polygon(0 0, 100% 0, 50% 100%)", 200, 100)).toEqual([
      ["M", 0, 0],
      ["L", 200, 0],
      ["L", 100, 100],
      ["Z"],
    ]);
  });

  it("leaves shape() to the DOM", () => {
    expect(clipToCommands("shape(from 0 0, line to 10px 0)", 10, 10)).toBeNull();
  });

  it("defaults circle() to closest-side at the centre and resolves % radii on the box diagonal", () => {
    expect(clipToCommands("circle()", 200, 100)).toEqual([["A", 100, 50, 50, 50, 0, 0, TAU], ["Z"]]);
    expect(clipToCommands("circle(50%)", 172, 172)).toEqual([["A", 86, 86, 86, 86, 0, 0, TAU], ["Z"]]);
    expect(clipToCommands("circle(10px at left top)", 100, 100)).toEqual([["A", 0, 0, 10, 10, 0, 0, TAU], ["Z"]]);
    // `utc` is 100x108: 50% of sqrt((w² + h²) / 2).
    const r = Math.sqrt((100 ** 2 + 108 ** 2) / 2) / 2;
    const [a, z] = clipToCommands("circle(50% at 50% 50%)", 100, 108)!;
    expect(a.slice(0, 3)).toEqual(["A", 50, 54]);
    expect(a[3]).toBeCloseTo(r, 9);
    expect(a[4]).toBeCloseTo(r, 9);
    expect(z).toEqual(["Z"]);
  });

  it("resolves ellipse radii per axis", () => {
    expect(clipToCommands("ellipse(50% 50% at 50% 50%)", 200, 100)).toEqual([["A", 100, 50, 100, 50, 0, 0, TAU], ["Z"]]);
    expect(clipToCommands("ellipse(20px 10% at 30px 40%)", 200, 100)).toEqual([["A", 30, 40, 20, 10, 0, 0, TAU], ["Z"]]);
  });

  it("mixes px and % in polygons and keeps values outside the box", () => {
    expect(clipToCommands("polygon(evenodd, 10px 0%, 100.5% -1%, 0 100%)", 200, 100)).toEqual([
      ["M", 10, 0],
      ["L", 201, -1],
      ["L", 0, 100],
      ["Z"],
    ]);
  });

  it("flattens path() curves to lines in px, ending on the curve's end point", () => {
    const cmds = clipToCommands("path('M0 0L100 0C100 50 50 100 0 100z')", 300, 300)!;
    expect(cmds[0]).toEqual(["M", 0, 0]);
    expect(cmds[1]).toEqual(["L", 100, 0]);
    expect(cmds.at(-1)).toEqual(["Z"]);
    const end = cmds.at(-2)!;
    expect(end[0]).toBe("L");
    expect(end[1]).toBeCloseTo(0, 9);
    expect(end[2]).toBeCloseTo(100, 9);
    expect(cmds.length).toBeGreaterThan(8);
    for (const c of cmds.slice(2, -1)) {
      expect(c[1] as number).toBeGreaterThanOrEqual(-1e-9);
      expect(c[2] as number).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it("accepts relative path commands and a fill rule", () => {
    expect(clipToCommands('path(nonzero, "m10 10 h20 v20 h-20 z")', 100, 100)).toEqual([
      ["M", 10, 10],
      ["L", 30, 10],
      ["L", 30, 30],
      ["L", 10, 30],
      ["Z"],
    ]);
  });

  it("returns null for syntaxes the prototype does not draw", () => {
    expect(clipToCommands("inset(10px round 4px)", 100, 100)).toBeNull();
    expect(clipToCommands("url(#mask)", 100, 100)).toBeNull();
    expect(clipToCommands("polygon(nonsense)", 100, 100)).toBeNull();
  });

  it("draws every real sticker clip except shape()", () => {
    const dir = path.resolve(import.meta.dirname, "../../src/data/stickers");
    const missed: string[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
      const s = parse(fs.readFileSync(path.join(dir, file), "utf8")) as { clipPath?: string; width: number; height: number };
      if (s.clipPath && !clipToCommands(s.clipPath, s.width, s.height)) missed.push(file);
    }
    expect(missed).toEqual(["pedantic.yaml"]);
  });
});
