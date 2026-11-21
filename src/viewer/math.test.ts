import { expect, test } from "vitest";
import golden from "../../tests/fixtures/rzpp-golden.json";
import type {
  GoldenEntry,
  GoldenFile,
  GoldenProfile,
  Op,
} from "../../tests/parity/replay";
import type { Transform } from "../lib/geometry";
import {
  boundsFor,
  centerTransform,
  clampScale,
  clampTransform,
  inertia,
  INERTIA_START_SPEED,
  MAX_SCALE,
  MIN_SCALE,
  wheelScale,
  zoomAt,
  type Size,
} from "./math";

type DragOp = Extract<Op, { t: "drag" }>;

const CONTENT: Size = { w: 3000, h: 3000 };
const VIEW: Size = { w: 1280, h: 800 };
const FRAME_60HZ = 1000 / 60;
// tests/parity/replay.ts moves the pointer every 16 ms while dragging.
const DRAG_STEP_MS = 16;
// Chromium reports wheel deltaY / devicePixelRatio; the mobile goldens store
// the page.mouse.wheel notch (see rzpp-defaults.md, "Wheel").
const MOBILE_DPR = 2.625;

const goldenFile = golden as unknown as GoldenFile;
const size = ([w, h]: [number, number]): Size => ({ w, h });
const round = (n: number, dp: number) => Number(n.toFixed(dp));

function entryOf(profile: GoldenProfile, name: string): GoldenEntry {
  const entry = profile.entries.find((e) => e.name === name);
  if (!entry) throw new Error(`golden ${profile.profile}/${name} is missing`);
  return entry;
}

function expectTransformNear(actual: Transform, expected: Transform, dp: number) {
  expect(actual.scale).toBe(expected.scale);
  expect(actual.x).toBeCloseTo(expected.x, dp);
  expect(actual.y).toBeCloseTo(expected.y, dp);
}

// The bounds probes recorded in Task 0.2: pushes past the bounds at 0.1 / 1 / 5.
const boundsProbes = goldenFile.profiles.flatMap((profile) =>
  profile.entries.flatMap((e) =>
    e.push && e.scale !== undefined && e.viewport
      ? [
          {
            name: `${profile.profile} ${e.name}`,
            push: e.push,
            scale: e.scale,
            viewport: size(e.viewport),
            expected: e.expected,
          },
        ]
      : []
  )
);

// Deterministic spread of transforms, including out-of-range scales/positions.
function* sweep(): Generator<Transform> {
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 400; i++) {
    yield {
      x: (next() - 0.5) * 40000,
      y: (next() - 0.5) * 40000,
      scale: Math.exp((next() - 0.5) * 12),
    };
  }
}

// ---------------------------------------------------------------- bounds

test("boundsFor matches the worked examples in rzpp-defaults.md", () => {
  expect(boundsFor(VIEW, CONTENT, 1)).toEqual({
    minX: -1720,
    maxX: 0,
    minY: -2200,
    maxY: 0,
  });
  expect(boundsFor(VIEW, CONTENT, 0.1)).toEqual({
    minX: 490,
    maxX: 490,
    minY: 250,
    maxY: 250,
  });
  expect(boundsFor(VIEW, CONTENT, 5)).toEqual({
    minX: -13720,
    maxX: 0,
    minY: -14200,
    maxY: 0,
  });
});

test("content smaller than the viewport collapses the bounds to the centre", () => {
  expect(boundsFor({ w: 1000, h: 600 }, { w: 200, h: 100 }, 1)).toEqual({
    minX: 400,
    maxX: 400,
    minY: 250,
    maxY: 250,
  });
  // One axis centred, the other pannable.
  expect(boundsFor(VIEW, { w: 3000, h: 100 }, 1)).toEqual({
    minX: -1720,
    maxX: 0,
    minY: 350,
    maxY: 350,
  });
  // Exactly filling the viewport leaves no room either way.
  expect(boundsFor({ w: 300, h: 300 }, CONTENT, 0.1)).toEqual({
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  });
});

test("a zero-size viewport yields finite bounds", () => {
  const zero: Size = { w: 0, h: 0 };
  expect(boundsFor(zero, CONTENT, 1)).toEqual({
    minX: -3000,
    maxX: 0,
    minY: -3000,
    maxY: 0,
  });
  expect(clampTransform({ x: 50, y: -9999, scale: 1 }, zero, CONTENT)).toEqual({
    x: 0,
    y: -3000,
    scale: 1,
  });
  expect(centerTransform(zero, CONTENT, 1)).toEqual({
    x: -1500,
    y: -1500,
    scale: 1,
  });
});

// ------------------------------------------------------------- clampTransform

test("clampTransform clamps scale to [MIN, MAX] and position to the bounds", () => {
  expect(MIN_SCALE).toBe(0.1);
  expect(MAX_SCALE).toBe(5);
  expect(
    clampTransform({ x: 9999, y: 9999, scale: 1 }, VIEW, CONTENT).x
  ).toBe(boundsFor(VIEW, CONTENT, 1).maxX);
  expect(
    clampTransform({ x: -9999, y: -9999, scale: 1 }, VIEW, CONTENT)
  ).toEqual({ x: -1720, y: -2200, scale: 1 });
  expect(clampTransform({ x: 0, y: 0, scale: 50 }, VIEW, CONTENT).scale).toBe(5);
  expect(clampTransform({ x: 0, y: 0, scale: 0.001 }, VIEW, CONTENT).scale).toBe(
    0.1
  );
  // Position is clamped against the bounds of the clamped scale: at scale 50
  // (-> 5) the lower x bound is -13720, not the scale-50 one.
  expect(
    clampTransform({ x: -1e6, y: 0, scale: 50 }, VIEW, CONTENT).x
  ).toBe(-13720);
});

test("clampTransform returns finite values for NaN or infinite input", () => {
  expect(clampTransform({ x: 0, y: 0, scale: NaN }, VIEW, CONTENT).scale).toBe(
    MIN_SCALE
  );
  expect(
    clampTransform({ x: 0, y: 0, scale: Infinity }, VIEW, CONTENT).scale
  ).toBe(MAX_SCALE);
  expect(
    clampTransform({ x: 0, y: 0, scale: -3 }, VIEW, CONTENT).scale
  ).toBe(MIN_SCALE);
  expect(
    clampTransform({ x: NaN, y: -Infinity, scale: 1 }, VIEW, CONTENT)
  ).toEqual({ x: -1720, y: -2200, scale: 1 });
});

test("clampTransform is idempotent, stays in bounds and does not mutate", () => {
  for (const t of sweep()) {
    const frozen = { ...t };
    const once = clampTransform(t, VIEW, CONTENT);
    expect(t).toEqual(frozen);
    expect(once).not.toBe(t);
    expect(clampTransform(once, VIEW, CONTENT)).toEqual(once);
    const b = boundsFor(VIEW, CONTENT, once.scale);
    expect(once.x).toBeGreaterThanOrEqual(b.minX);
    expect(once.x).toBeLessThanOrEqual(b.maxX);
    expect(once.y).toBeGreaterThanOrEqual(b.minY);
    expect(once.y).toBeLessThanOrEqual(b.maxY);
  }
});

test("clampScale maps NaN and out-of-range scales into [MIN, MAX]", () => {
  expect(clampScale(1)).toBe(1);
  expect(clampScale(0)).toBe(MIN_SCALE);
  expect(clampScale(-1)).toBe(MIN_SCALE);
  expect(clampScale(NaN)).toBe(MIN_SCALE);
  expect(clampScale(5.0001)).toBe(MAX_SCALE);
});

test("bounds probes recorded from the baseline clamp to the recorded end state", () => {
  expect(boundsProbes).toHaveLength(30);
  for (const probe of boundsProbes) {
    expect(
      clampTransform(
        { x: probe.push[0], y: probe.push[1], scale: probe.scale },
        probe.viewport,
        CONTENT
      ),
      probe.name
    ).toMatchObject(probe.expected);
  }
});

for (const profile of goldenFile.profiles) {
  test(`${profile.profile}: an instant re-clamp on resize matches the baseline`, () => {
    const entry = entryOf(profile, "resize-reclamp");
    const resize = entry.ops[entry.ops.length - 1] as Extract<
      Op,
      { t: "resize" }
    >;
    expect(resize.t).toBe("resize");
    // The flick before the resize leaves the canvas against its left edge.
    const before = size(profile.viewport);
    const atLeftEdge = clampTransform(
      { x: -1e6, y: centerTransform(before, CONTENT, 1).y, scale: 1 },
      before,
      CONTENT
    );
    expect(clampTransform(atLeftEdge, size(resize.to), CONTENT)).toMatchObject(
      entry.expected
    );
  });
}

// ----------------------------------------------------------- centerTransform

for (const profile of goldenFile.profiles) {
  test(`${profile.profile}: centerTransform reproduces centerOnInit and the centre button`, () => {
    const view = size(profile.viewport);
    expect(centerTransform(view, CONTENT, 1)).toEqual(
      entryOf(profile, "initial-centred").expected
    );
    const centre = entryOf(profile, "button-center").expected;
    expectTransformNear(centerTransform(view, CONTENT, centre.scale), centre, 9);
  });
}

test("centerTransform keeps the scale valid and the result inside the bounds", () => {
  expect(centerTransform(VIEW, CONTENT, 50).scale).toBe(MAX_SCALE);
  expect(centerTransform(VIEW, CONTENT, NaN)).toEqual({
    x: 490,
    y: 250,
    scale: MIN_SCALE,
  });
  for (const scale of [0.1, 0.5, 1, 1.65, 5]) {
    const t = centerTransform(VIEW, CONTENT, scale);
    expect(clampTransform(t, VIEW, CONTENT)).toEqual(t);
  }
});

// -------------------------------------------------------------------- zoomAt

test("zoomAt keeps the viewport-space anchor fixed", () => {
  expect(
    zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100 }, 2)
  ).toEqual({ x: -100, y: -100, scale: 2 });

  const start: Transform = { x: -860, y: -1100, scale: 1 };
  const anchor = { x: 384, y: 320 };
  for (const next of [0.1, 0.61, 2.01, 5, 7]) {
    const t = zoomAt(start, anchor, next);
    expect(t.scale).toBe(next);
    // Canvas point under the anchor is the same before and after.
    expect((anchor.x - t.x) / t.scale).toBeCloseTo(
      (anchor.x - start.x) / start.scale,
      9
    );
    expect((anchor.y - t.y) / t.scale).toBeCloseTo(
      (anchor.y - start.y) / start.scale,
      9
    );
  }
});

test("zoomAt is a no-op for an unchanged scale and returns a fresh object", () => {
  const t: Transform = { x: 0.1 + 0.2, y: -123.456, scale: 1.65 };
  const out = zoomAt(t, { x: 7.7, y: 9.9 }, 1.65);
  expect(out).toEqual(t);
  expect(out).not.toBe(t);
});

test("zoomAt never produces NaN for an invalid scale", () => {
  const t: Transform = { x: -860, y: -1100, scale: 1 };
  for (const bad of [NaN, 0, -2, Infinity, -Infinity]) {
    expect(zoomAt(t, { x: 10, y: 10 }, bad)).toEqual(t);
  }
  // A corrupt current scale cannot be divided by; the position is kept.
  for (const badFrom of [0, -1, NaN]) {
    const out = zoomAt({ x: 5, y: 6, scale: badFrom }, { x: 1, y: 1 }, 2);
    expect(out).toEqual({ x: 5, y: 6, scale: 2 });
  }
});

for (const profile of goldenFile.profiles) {
  const view = size(profile.viewport);
  const start = centerTransform(view, CONTENT, 1);
  // rzpp's zoom-in/out step: scale * exp(step) at 3 dp, then 2 dp (rzpp-defaults.md §3).
  const stepScale = (scale: number, step: number) =>
    round(round(scale * Math.exp(step), 3), 2);

  test(`${profile.profile}: double click zooms about the pointer like the baseline`, () => {
    const entry = entryOf(profile, "dblclick");
    const op = entry.ops[0] as Extract<Op, { t: "dblclick" }>;
    const t = clampTransform(
      zoomAt(start, { x: op.at[0], y: op.at[1] }, stepScale(1, 0.7)),
      view,
      CONTENT
    );
    expectTransformNear(t, entry.expected, 1);
  });

  for (const [name, step] of [
    ["button-zoom-in", 0.5],
    ["button-zoom-out", -0.5],
  ] as const) {
    test(`${profile.profile}: ${name} zooms about the viewport centre like the baseline`, () => {
      const entry = entryOf(profile, name);
      const t = clampTransform(
        zoomAt(start, { x: view.w / 2, y: view.h / 2 }, stepScale(1, step)),
        view,
        CONTENT
      );
      expectTransformNear(t, entry.expected, 1);
    });
  }
}

// ---------------------------------------------------------------- wheelScale

// Transcription of rzpp handleCalculateWheelZoom + checkZoomBounds for the
// baseline options (smooth wheel, 0.4 scale padding on ctrl).
function rzppWheel(scale: number, deltaY: number, ctrlKey: boolean): number {
  const target = round(scale + (deltaY < 0 ? 1 : -1) * 0.001 * Math.abs(deltaY), 3);
  const min = ctrlKey ? MIN_SCALE - 0.4 : MIN_SCALE;
  if (target >= MAX_SCALE) return MAX_SCALE;
  if (target <= min) return min;
  return target;
}

test("wheelScale reproduces rzpp's smooth wheel step with 3 dp rounding", () => {
  expect(wheelScale(1, -100, false)).toBe(1.1);
  expect(wheelScale(1, 100, false)).toBe(0.9);
  expect(wheelScale(1, 0, false)).toBe(1);
  // Chromium on a DPR 2.625 device: -263 / 2.625 = -100.19 still rounds to 0.1.
  expect(wheelScale(1, -263 / MOBILE_DPR, false)).toBe(1.1);

  const scales = [0.1, 0.25, 0.5, 1, 1.65, 2.01, 3.3, 4.9, 5];
  const deltas = [
    -1052, -400.76, -262, -100.19, -100, -38.1, -10, -3, -1, 1, 3, 10, 38.1, 100,
    100.19, 262, 400.76, 1052,
  ];
  for (const scale of scales) {
    for (const deltaY of deltas) {
      expect(wheelScale(scale, deltaY, false)).toBe(
        rzppWheel(scale, deltaY, false)
      );
    }
  }
});

test("a plain wheel clamps to [MIN, MAX]; ctrl (trackpad pinch) may dip below MIN", () => {
  expect(wheelScale(4.9, -400, false)).toBe(MAX_SCALE);
  expect(wheelScale(5, -100, true)).toBe(MAX_SCALE);
  expect(wheelScale(0.15, 400, false)).toBe(MIN_SCALE);
  expect(wheelScale(0.12, 50, true)).toBe(0.07);
  expect(wheelScale(0.12, 50, false)).toBe(MIN_SCALE);

  // rzpp pads by 0.4 and would reach MIN - 0.4 = -0.3 (a mirrored layer); the
  // overshoot is floored at a positive scale instead, and otherwise identical.
  const scales = [0.05, 0.1, 0.25, 1, 4.9];
  const deltas = [-400.76, -100.19, -10, -1, 1, 10, 100.19, 400.76, 1052];
  for (const scale of scales) {
    for (const deltaY of deltas) {
      const result = wheelScale(scale, deltaY, true);
      expect(result).toBeGreaterThan(0);
      expect(result).toBe(Math.max(rzppWheel(scale, deltaY, true), 0.05));
    }
  }
});

test("wheelScale never returns NaN or a non-positive scale", () => {
  for (const scale of [NaN, -1, 0, Infinity, 1]) {
    for (const deltaY of [NaN, -Infinity, Infinity, -100, 0, 100]) {
      for (const ctrl of [false, true]) {
        const result = wheelScale(scale, deltaY, ctrl);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(MAX_SCALE);
      }
    }
  }
  // A NaN deltaY changes nothing.
  expect(wheelScale(2, NaN, false)).toBe(2);
});

for (const profile of goldenFile.profiles) {
  const view = size(profile.viewport);
  const dpr = profile.profile === "mobile" ? MOBILE_DPR : 1;

  for (const name of [
    "wheel-zoom-in-ramp",
    "wheel-zoom-in-to-max",
    "wheel-zoom-out-to-min",
  ]) {
    test(`${profile.profile}: ${name} replays through wheelScale, zoomAt and clampTransform`, () => {
      const entry = entryOf(profile, name);
      let t = centerTransform(view, CONTENT, 1);
      for (const op of entry.ops) {
        if (op.t !== "wheel") throw new Error(`unexpected op ${op.t}`);
        t = zoomAt(
          t,
          { x: op.at[0], y: op.at[1] },
          wheelScale(t.scale, op.deltaY / dpr, false)
        );
      }
      // Position is only clamped once the wheel stops (align-to-bounds).
      t = clampTransform(t, view, CONTENT);
      // rzpp rounds every position to 2 dp; the measured drift is <= 0.03 px.
      expectTransformNear(t, entry.expected, 1);
    });
  }
}

// ------------------------------------------------------------------- inertia

// rzpp: duration max(400 ms * speed, 400 ms), per-frame step v * (1 - easeOut(t / D))
// with v the last event's pixel delta, so a flick travels about v * D / 2 pixels.
// Speed here is px/ms.
const rzppFlickDistance = (speed: number) =>
  (speed * 400 * Math.max(1, speed)) / 2;

function fling(
  start: { x: number; y: number },
  dtMs: number,
  maxFrames = 20000
) {
  const velocity = { ...start };
  let x = 0;
  let y = 0;
  let frames = 0;
  for (;;) {
    const step = inertia(velocity, dtMs);
    x += step.dx;
    y += step.dy;
    frames++;
    if (step.done || frames >= maxFrames) {
      return { x, y, frames, done: step.done };
    }
  }
}

test("inertia travels in the direction of the flick and decays the velocity in place", () => {
  const velocity = { x: -1.2, y: 0.5 };
  const first = inertia(velocity, FRAME_60HZ);
  expect(first.dx).toBeLessThan(0);
  expect(first.dy).toBeGreaterThan(0);
  expect(first.dx / first.dy).toBeCloseTo(-1.2 / 0.5, 9);
  expect(first.done).toBe(false);
  expect(Math.hypot(velocity.x, velocity.y)).toBeLessThan(Math.hypot(-1.2, 0.5));
  expect(velocity.x / velocity.y).toBeCloseTo(-1.2 / 0.5, 9);

  let previous = Math.hypot(first.dx, first.dy);
  for (let i = 0; i < 20; i++) {
    const step = inertia(velocity, FRAME_60HZ);
    const length = Math.hypot(step.dx, step.dy);
    expect(length).toBeLessThanOrEqual(previous);
    previous = length;
  }
});

test("inertia always terminates, even for a very large flick", () => {
  const dt = 16.7;
  for (const speed of [INERTIA_START_SPEED, 0.5, 1, 2, 5, 10, 20]) {
    for (const angle of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1]) {
      const v = { x: speed * Math.cos(angle), y: speed * Math.sin(angle) };
      const result = fling(v, dt);
      expect(result.done, `speed ${speed} angle ${angle}`).toBe(true);
      // 400 ms per px/ms above 1, then a 200 ms time-constant tail down to the
      // 0.02 px/ms stop speed (about 0.8 s).
      const bound = Math.ceil((400 * Math.max(0, speed - 1) + 800) / dt) + 2;
      expect(result.frames).toBeLessThanOrEqual(bound);
    }
  }
});

test("inertia with no usable velocity is done immediately and moves nothing", () => {
  for (const v of [
    { x: 0, y: 0 },
    { x: NaN, y: 1 },
    { x: Infinity, y: 0 },
    { x: 0.005, y: -0.005 },
  ]) {
    expect(inertia({ ...v }, FRAME_60HZ)).toEqual({ dx: 0, dy: 0, done: true });
  }
});

test("a non-positive or NaN dtMs moves nothing and does not decay", () => {
  for (const dt of [0, -16, NaN]) {
    const v = { x: 1, y: -1 };
    expect(inertia(v, dt)).toEqual({ dx: 0, dy: 0, done: false });
    expect(v).toEqual({ x: 1, y: -1 });
  }
});

test("inertia matches rzpp's flick distance at 60 Hz", () => {
  // rzpp's raised-cosine profile and this law differ in shape but cover the
  // same distance for every release speed; the remainder is the sub-pixel tail
  // below the 0.02 px/ms stop speed (<= 0.02 * 200 ms = 4 px).
  for (const speed of [0.15, 0.3, 0.6, 1, 1.5, 2.3, 3.75, 6]) {
    const { x, y } = fling({ x: speed, y: 0 }, FRAME_60HZ);
    expect(y).toBe(0);
    expect(rzppFlickDistance(speed) - x).toBeGreaterThan(-1);
    expect(rzppFlickDistance(speed) - x).toBeLessThan(5);
  }
});

test("inertia travels the same distance at 120 Hz, 60 Hz and 30 Hz", () => {
  // The law is integrated exactly per frame, so the only difference is where
  // the first sub-threshold frame falls: at most 4 px * (1 - exp(-33 / 200)) < 1 px.
  for (const speed of [0.3, 1, 2.4, 8]) {
    const v = { x: speed * 0.6, y: -speed * 0.8 };
    const ref = fling(v, 16.7);
    for (const dt of [8.3, 33]) {
      const other = fling(v, dt);
      expect(Math.abs(other.x - ref.x)).toBeLessThan(1);
      expect(Math.abs(other.y - ref.y)).toBeLessThan(1);
    }
  }
  // Splitting one frame in two changes nothing at all.
  const a = { x: 3, y: 1 };
  const b = { x: 3, y: 1 };
  const whole = inertia(a, 33.4);
  const half1 = inertia(b, 16.7);
  const half2 = inertia(b, 16.7);
  expect(half1.dx + half2.dx).toBeCloseTo(whole.dx, 9);
  expect(half1.dy + half2.dy).toBeCloseTo(whole.dy, 9);
  expect(b.x).toBeCloseTo(a.x, 9);
  expect(b.y).toBeCloseTo(a.y, 9);
});

for (const profile of goldenFile.profiles) {
  const view = size(profile.viewport);
  const start = centerTransform(view, CONTENT, 1);

  // Pointer-up rule: last move delta / its interval. The recorded events were
  // really spaced wider than 16 ms (rzpp-defaults.md §4), so these speeds are
  // nominal; the goldens only use flicks that saturate at the bounds.
  function dragThenFling(t: Transform, drag: DragOp): Transform {
    const steps = Math.max(1, Math.round(drag.ms / DRAG_STEP_MS));
    const v = {
      x: drag.by[0] / steps / DRAG_STEP_MS,
      y: drag.by[1] / steps / DRAG_STEP_MS,
    };
    const dragged = clampTransform(
      { x: t.x + drag.by[0], y: t.y + drag.by[1], scale: t.scale },
      view,
      CONTENT
    );
    if (Math.hypot(v.x, v.y) <= INERTIA_START_SPEED) return dragged;
    const { x, y } = fling(v, FRAME_60HZ);
    return clampTransform(
      { x: dragged.x + x, y: dragged.y + y, scale: t.scale },
      view,
      CONTENT
    );
  }

  for (const name of ["flick-left", "flick-up", "slow-drag"]) {
    test(`${profile.profile}: ${name} ends where the baseline ended`, () => {
      const entry = entryOf(profile, name);
      let t = start;
      for (const op of entry.ops) {
        if (op.t !== "drag") throw new Error(`unexpected op ${op.t}`);
        t = dragThenFling(t, op);
      }
      expect(t).toEqual(entry.expected);
    });
  }
}
