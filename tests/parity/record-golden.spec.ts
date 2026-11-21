// Recorder for the baseline parity fixtures. Not part of the normal suite:
// it only runs with RECORD=1 against the unchanged baseline build.
//
//   $env:RECORD='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'
//   npx playwright test tests/parity/record-golden.spec.ts --workers=1 `
//     --project=chromium-desktop --project=chromium-mobile
//
// Writes tests/fixtures/placement.json (desktop project only) and merges this
// profile into tests/fixtures/rzpp-golden.json as { profiles: [desktop, mobile] }.
// GOLDEN_OUT redirects the golden file (used for the determinism re-run).
//
// Every golden entry starts from a freshly loaded page (centred, scale 1, the
// project's own viewport), uses only real input (page.mouse, page.mouse.wheel,
// CDP touch for drags on mobile), and `expected` is read once the transform
// has been unchanged for 600 ms.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { contract, target } from "../contract.ts";
import {
  BETWEEN_OPS_QUIET_MS,
  FINAL_QUIET_MS,
  loadFresh,
  readTransform,
  replay,
  settled,
  type GoldenEntry,
  type GoldenFile,
  type GoldenProfile,
  type Op,
  type Transform,
} from "./replay.ts";

const CANVAS = 3000;
const fixtures = path.resolve(process.cwd(), "tests", "fixtures");
const stickersPath = path.join(fixtures, "stickers.baseline.json");
const placementPath = path.join(fixtures, "placement.json");
const goldenPath = path.resolve(
  process.cwd(),
  process.env.GOLDEN_OUT ?? path.join("tests", "fixtures", "rzpp-golden.json")
);

const PROFILES: Record<
  string,
  { profile: "desktop" | "mobile"; input: "mouse" | "touch"; viewport: [number, number] }
> = {
  "chromium-desktop": { profile: "desktop", input: "mouse", viewport: [1280, 800] },
  "chromium-mobile": { profile: "mobile", input: "touch", viewport: [412, 839] },
};

interface StickerRecord {
  slug: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  image?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const R = Math.round;

function round(t: Transform): Transform {
  return { x: r2(t.x), y: r2(t.y), scale: r4(t.scale) };
}

test.describe("baseline recorder", () => {
  test.skip(process.env.RECORD !== "1", "recorder: set RECORD=1 to run");
  test.skip(target !== "baseline", "recorder: set TARGET=baseline");

  test("placement", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-desktop",
      "placement is viewport independent; recorded on chromium-desktop only"
    );
    const stickers: StickerRecord[] = JSON.parse(fs.readFileSync(stickersPath, "utf8"));
    await loadFresh(page, PROFILES["chromium-desktop"].viewport);

    const dom = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => ({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
        rotate: getComputedStyle(el).rotate,
        img: el.querySelector("img")?.getAttribute("src") ?? null,
      }));
    }, contract.stickers);
    expect(dom).toHaveLength(stickers.length);

    const placement: Record<string, object> = {};
    stickers.forEach((s, i) => {
      const d = dom[i];
      // DOM order is the yaml order; confirm the zip by image where there is one.
      if (s.image) expect(d.img, s.slug).toBe(s.image);
      expect(Math.abs(d.left - (s.x + (CANVAS - s.width) / 2)), `${s.slug} left`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.top - (s.y + (CANVAS - s.height) / 2)), `${s.slug} top`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.width - s.width), `${s.slug} width`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.height - s.height), `${s.slug} height`).toBeLessThanOrEqual(1);
      expect(d.rotate, `${s.slug} rotate`).toBe(s.rotation ? `${s.rotation}deg` : "none");
      placement[s.slug] = {
        left: d.left,
        top: d.top,
        width: d.width,
        height: d.height,
        rotate: d.rotate,
      };
    });
    expect(Object.keys(placement)).toHaveLength(stickers.length);
    fs.writeFileSync(placementPath, JSON.stringify(placement, null, 2) + "\n");
    console.log(`placement: ${stickers.length} stickers within 1 px of the formula`);
  });

  test("gesture goldens", async ({ page }, info) => {
    const cfg = PROFILES[info.project.name];
    test.skip(!cfg, "gesture goldens are recorded on chromium-desktop and chromium-mobile");
    test.setTimeout(60 * 60_000);

    const [vw, vh] = cfg.viewport;
    await loadFresh(page, cfg.viewport);
    expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([vw, vh]);
    const dsf = await page.evaluate(() => devicePixelRatio);
    // Chromium reports wheel deltaY / devicePixelRatio, so scale the notch to
    // keep one notch worth about 0.1 of zoom on both profiles.
    const notch = R(100 * dsf);

    const specs = buildSpecs(cfg.profile, vw, vh, notch);
    const entries: GoldenEntry[] = [];
    for (const spec of specs) {
      await loadFresh(page, cfg.viewport);
      const isBounds = spec.name.startsWith("bounds-");
      let before: Transform | undefined;
      if (isBounds) {
        await replay(page, spec.ops.slice(0, -1), { input: cfg.input });
        await settled(page, BETWEEN_OPS_QUIET_MS);
        before = await readTransform(page);
        await replay(page, spec.ops.slice(-1), { input: cfg.input });
      } else {
        await replay(page, spec.ops, { input: cfg.input });
      }
      await settled(page, FINAL_QUIET_MS);
      const expected = round(await readTransform(page));
      await expect(page.locator(contract.sheetHandle), `${spec.name} opened the sheet`).toHaveCount(0);

      const entry: GoldenEntry = { name: spec.name, ops: spec.ops, expected };
      if (before) {
        const push = spec.ops[spec.ops.length - 1] as Extract<Op, { t: "drag" }>;
        entry.push = [r2(before.x + push.by[0]), r2(before.y + push.by[1])];
        entry.scale = r4(before.scale);
        entry.viewport = [vw, vh];
      }
      entries.push(entry);
      console.log(`${cfg.profile} ${spec.name}: ${JSON.stringify(expected)}`);
    }

    const profile: GoldenProfile = { profile: cfg.profile, viewport: cfg.viewport, entries };
    writeProfile(profile);
  });
});

function writeProfile(profile: GoldenProfile) {
  let existing: GoldenFile = { profiles: [] };
  if (fs.existsSync(goldenPath)) {
    existing = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  }
  const profiles = existing.profiles.filter((p) => p.profile !== profile.profile);
  profiles.push(profile);
  profiles.sort((a, b) => (a.profile < b.profile ? -1 : 1));
  fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
  fs.writeFileSync(goldenPath, JSON.stringify({ profiles }, null, 2) + "\n");
}

interface Spec {
  name: string;
  ops: Op[];
}

function buildSpecs(
  profile: "desktop" | "mobile",
  vw: number,
  vh: number,
  notch: number
): Spec[] {
  const at: [number, number] = [R(vw * 0.3), R(vh * 0.4)];
  const wheels = (n: number, deltaY: number, where: [number, number]): Op[] =>
    Array.from({ length: n }, (): Op => ({ t: "wheel", at: where, deltaY }));
  const drag = (from: [number, number], by: [number, number], ms: number): Op => ({
    t: "drag",
    from,
    by,
    ms,
  });

  // Slow enough (~0.04 px/ms at release) that rzpp starts no inertia.
  const slowDrag = drag(at, [-120, -60], 3000);

  // Fast flicks that run into a bound: inertia distance depends on event
  // timing and frame count (tens of px of jitter), so a flick is only a stable
  // golden when inertia carries it all the way to the edge. Margins are at
  // least 3x on the single flicks (measured inertia 900-1800 px against a
  // required 260-400 px); mobile needs three horizontal flicks because a
  // 412 px viewport caps one flick at about 380 px.
  const flickLeft: Op[] =
    profile === "desktop"
      ? [drag([R(vw * 0.86), R(vh * 0.3)], [-600, 0], 160)]
      : Array.from({ length: 3 }, () => drag([R(vw * 0.96), R(vh * 0.3)], [-R(vw * 0.92), 0], 160));
  const flickUp: Op[] = [drag([R(vw * 0.25), R(vh * 0.95)], [0, -R(vh * 0.93)], 160)];

  const specs: Spec[] = [
    { name: "initial-centred", ops: [] },
    { name: "wheel-zoom-in-ramp", ops: wheels(12, -notch, at) },
    { name: "wheel-zoom-in-to-max", ops: wheels(14, -4 * notch, at) },
    { name: "wheel-zoom-out-to-min", ops: wheels(14, notch, at) },
    { name: "slow-drag", ops: [slowDrag] },
    { name: "flick-left", ops: flickLeft },
    { name: "flick-up", ops: flickUp },
    { name: "dblclick", ops: [{ t: "dblclick", at }] },
    { name: "button-zoom-in", ops: [{ t: "click", control: "zoomIn" }] },
    { name: "button-zoom-out", ops: [{ t: "click", control: "zoomOut" }] },
    {
      name: "button-center",
      ops: [{ t: "click", control: "zoomIn" }, slowDrag, { t: "click", control: "center" }],
    },
    {
      name: "resize-reclamp",
      ops: [...flickLeft, { t: "resize", to: profile === "desktop" ? [1500, 900] : [600, 900] }],
    },
  ];
  specs.push(...boundsSpecs(vw, vh, notch));
  return specs;
}

// Drag far past each edge at scales 0.1, 1 and 5. Each probe first parks the
// content against the relevant edge at scale 1 (flick drags that always
// over-shoot, so they end clamped), then zooms about the matching corner (which
// keeps the content against that edge) and finally pushes about 85 % of the
// viewport past it. The last op of every probe is the push.
function boundsSpecs(vw: number, vh: number, notch: number): Spec[] {
  const dirs: [string, number, number][] = [
    ["right", 1, 0],
    ["left", -1, 0],
    ["down", 0, 1],
    ["up", 0, -1],
    ["right-up", 1, -1],
  ];
  const stepX = Math.floor(0.85 * vw);
  const stepY = Math.floor(0.85 * vh);
  const nX = Math.ceil((CANVAS - vw) / 2 / stepX);
  const nY = Math.ceil((CANVAS - vh) / 2 / stepY);
  const specs: Spec[] = [];
  for (const scale of [0.1, 1, 5]) {
    for (const [dirName, mx, my] of dirs) {
      const fromX = mx > 0 ? R(0.05 * vw) : mx < 0 ? R(0.9 * vw) : R(0.2 * vw);
      const fromY = my > 0 ? R(0.05 * vh) : my < 0 ? R(0.9 * vh) : R(0.3 * vh);
      const anchor: [number, number] = [
        mx > 0 ? 0 : mx < 0 ? vw - 1 : R(vw / 2),
        my > 0 ? 0 : my < 0 ? vh - 1 : R(vh / 2),
      ];
      const ops: Op[] = [];
      const wheel = (deltaY: number, where: [number, number]): Op => ({
        t: "wheel",
        at: where,
        deltaY,
      });
      if (scale === 0.1) {
        // Content is centred once it is smaller than the viewport, so no parking.
        for (let i = 0; i < 4; i++) ops.push(wheel(4 * notch, [R(vw / 2), R(vh / 2)]));
      } else {
        if (mx) {
          for (let i = 0; i < nX; i++) {
            ops.push({ t: "drag", from: [fromX, R(0.3 * vh)], by: [mx * stepX, 0], ms: 160 });
          }
        }
        if (my) {
          for (let i = 0; i < nY; i++) {
            ops.push({ t: "drag", from: [R(0.2 * vw), fromY], by: [0, my * stepY], ms: 160 });
          }
        }
        if (scale === 5) for (let i = 0; i < 10; i++) ops.push(wheel(-4 * notch, anchor));
      }
      ops.push({ t: "drag", from: [fromX, fromY], by: [mx * stepX, my * stepY], ms: 160 });
      specs.push({ name: `bounds-scale${scale}-${dirName}`, ops });
    }
  }
  return specs;
}
