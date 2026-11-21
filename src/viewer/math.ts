// Pure transform maths for the viewer gesture controller. It replaces
// react-zoom-pan-pinch 3.7.0 numerically; "L" references are lines of that
// library's dist/index.esm.js, as catalogued in
// docs/superpowers/baseline/rzpp-defaults.md. No DOM, no timers, and nothing
// is allocated beyond the returned object.
//
// Coordinates: a Transform places the canvas at (x, y) in viewport pixels with
// the given scale, so a canvas point p appears at (x + p * scale). Anchors are
// viewport pixels relative to the viewer's top-left corner.
import type { Transform } from "../lib/geometry";

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Releases slower than this (px/ms) do not start inertia (L559-L561). */
export const INERTIA_START_SPEED = 0.1;

// Below this speed (px/ms) the glide is over: under 0.02 px/ms * 200 ms = 4 px
// of travel remain.
const INERTIA_STOP_SPEED = 0.02;
// Time constant (ms) of the exponential tail, and the linear deceleration
// (ms per px/ms) above 1 px/ms; see inertia().
const INERTIA_TAU_MS = 200;
const INERTIA_LINEAR_MS = 400;
// Ctrl-wheel may overshoot MIN_SCALE; rzpp pads by 0.4 (below zero), here the
// overshoot stops at half the minimum so the scale stays positive.
const OVERSHOOT_FLOOR = MIN_SCALE / 2;

/** Clamps to [MIN_SCALE, MAX_SCALE]; NaN becomes MIN_SCALE. */
export function clampScale(scale: number): number {
  return scale >= MAX_SCALE ? MAX_SCALE : scale > MIN_SCALE ? scale : MIN_SCALE;
}

// Content smaller than the viewport is centred (centerZoomedOut: false,
// L196-L208), otherwise its edges may not leave the viewport.
function lowerBound(viewport: number, content: number, scale: number): number {
  const free = viewport - content * scale;
  return free > 0 ? free / 2 : free;
}

function upperBound(viewport: number, content: number, scale: number): number {
  const free = viewport - content * scale;
  return free > 0 ? free / 2 : 0;
}

// Written so a NaN position falls to the lower bound instead of propagating.
function clampAxis(value: number, min: number, max: number): number {
  return value >= min ? (value <= max ? value : max) : min;
}

/** Position limits for `scale` (L196-L208, "Bounds" in rzpp-defaults.md). */
export function boundsFor(viewport: Size, content: Size, scale: number): Bounds {
  return {
    minX: lowerBound(viewport.w, content.w, scale),
    maxX: upperBound(viewport.w, content.w, scale),
    minY: lowerBound(viewport.h, content.h, scale),
    maxY: upperBound(viewport.h, content.h, scale),
  };
}

/**
 * Scale into [MIN_SCALE, MAX_SCALE], then position into the bounds of that
 * scale (boundLimiter, L226-L234, without its 2 dp rounding).
 */
export function clampTransform(
  t: Transform,
  viewport: Size,
  content: Size
): Transform {
  const scale = clampScale(t.scale);
  return {
    x: clampAxis(
      t.x,
      lowerBound(viewport.w, content.w, scale),
      upperBound(viewport.w, content.w, scale)
    ),
    y: clampAxis(
      t.y,
      lowerBound(viewport.h, content.h, scale),
      upperBound(viewport.h, content.h, scale)
    ),
    scale,
  };
}

/**
 * Changes the scale while the canvas point under `anchor` (viewport pixels)
 * stays put (L254-L267). The scale is not clamped here, so ctrl-wheel can
 * overshoot; pass it through clampScale / clampTransform when it must not. An
 * invalid `nextScale` leaves the transform unchanged.
 */
export function zoomAt(
  t: Transform,
  anchor: { x: number; y: number },
  nextScale: number
): Transform {
  const from = t.scale;
  if (!(nextScale > 0 && nextScale < Infinity) || nextScale === from) {
    return { x: t.x, y: t.y, scale: from };
  }
  const ratio = from > 0 ? nextScale / from : 1;
  return {
    x: anchor.x - (anchor.x - t.x) * ratio,
    y: anchor.y - (anchor.y - t.y) * ratio,
    scale: nextScale,
  };
}

/** Centres the content at `scale`, ignoring panels (setCenter, L987-L995). */
export function centerTransform(
  viewport: Size,
  content: Size,
  scale: number
): Transform {
  const s = clampScale(scale);
  return {
    x: (viewport.w - content.w * s) / 2,
    y: (viewport.h - content.h * s) / 2,
    scale: s,
  };
}

/**
 * Next scale for a wheel event: `scale + sign * 0.001 * |deltaY|` rounded to
 * 3 dp, with deltaY < 0 zooming in (smooth wheel, L1029-L1034, L1061-L1075).
 * A plain wheel is clamped to [MIN_SCALE, MAX_SCALE]; with `ctrlKey` (trackpad
 * pinch) it may dip below MIN_SCALE to OVERSHOOT_FLOOR so the caller can
 * realign afterwards, like rzpp's 0.4 zoom padding. deltaMode is not
 * considered, as in rzpp.
 */
export function wheelScale(
  scale: number,
  deltaY: number,
  ctrlKey: boolean
): number {
  const step = 0.001 * Math.abs(deltaY);
  const target =
    step === step
      ? Math.round((deltaY < 0 ? scale + step : scale - step) * 1000) / 1000
      : scale;
  const floor = ctrlKey ? OVERSHOOT_FLOOR : MIN_SCALE;
  return target >= MAX_SCALE ? MAX_SCALE : target > floor ? target : floor;
}

/**
 * One frame of release inertia (handleVelocityPanning, L469-L510).
 *
 * `velocity` is the pointer speed in px/ms (last move delta / its interval)
 * and is the live glide state: it is DECAYED IN PLACE, so call this every
 * frame with the same object. Returns the displacement over `dtMs` and whether
 * the glide has ended (the final frame's displacement is still valid).
 *
 * rzpp runs max(400 ms * speed, 400 ms) with a raised-cosine ease, covering
 * `speed * duration / 2` px at 60 Hz input. A step function without elapsed
 * time cannot use that profile, so the speed decays by a memoryless law that
 * covers the same distance: linearly at 1 / 400 px/ms per ms while above
 * 1 px/ms, then exponentially with a 200 ms time constant. That gives
 * 200 * speed px for speed <= 1 and 200 * speed^2 px above, rzpp's 60 Hz totals.
 * Each frame integrates the law exactly, so the travel does not depend on dtMs.
 */
export function inertia(
  velocity: { x: number; y: number },
  dtMs: number
): { dx: number; dy: number; done: boolean } {
  const vx = velocity.x;
  const vy = velocity.y;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (!(speed >= INERTIA_STOP_SPEED && speed < Infinity)) {
    velocity.x = 0;
    velocity.y = 0;
    return { dx: 0, dy: 0, done: true };
  }
  if (!(dtMs > 0)) return { dx: 0, dy: 0, done: false };

  let distance = 0;
  let current = speed;
  let remaining = dtMs;
  if (current > 1) {
    const linearMs = Math.min(remaining, (current - 1) * INERTIA_LINEAR_MS);
    const end = current - linearMs / INERTIA_LINEAR_MS;
    distance = ((current + end) / 2) * linearMs;
    current = end;
    remaining -= linearMs;
  }
  if (remaining > 0) {
    distance += current * INERTIA_TAU_MS * -Math.expm1(-remaining / INERTIA_TAU_MS);
    current *= Math.exp(-remaining / INERTIA_TAU_MS);
  }

  const keep = current / speed;
  velocity.x = vx * keep;
  velocity.y = vy * keep;
  const along = distance / speed;
  return {
    dx: vx * along,
    dy: vy * along,
    done: current < INERTIA_STOP_SPEED,
  };
}
