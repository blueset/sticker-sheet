// Framework-free pan and zoom for the sticker canvas, replacing
// react-zoom-pan-pinch 3.7.0 (docs/superpowers/baseline/rzpp-defaults.md) on
// top of the pure maths in ./math. Input handlers only update the state; one
// requestAnimationFrame callback advances animations, writes the layer's
// transform (at most once per frame) and notifies onChange.
import type { Transform } from "../lib/geometry";
import {
  INERTIA_START_SPEED,
  MAX_SCALE,
  MIN_SCALE,
  boundsFor,
  centerTransform,
  clampScale,
  clampTransform,
  inertia,
  wheelScale,
  zoomAt,
  type Size,
} from "./math";

export interface Controller {
  readonly transform: Transform;
  setTransform(t: Transform, opts?: { animateMs?: number }): void; // clamped; default animation per rzpp-defaults.md for programmatic moves
  zoomBy(factor: number, anchor?: { x: number; y: number }): void;
  center(): void;
  onGestureStart(fn: () => void): () => void; // user input only (hold, tooltip, selection)
  // Every idle -> moving edge, user or programmatic (button zoom, centre,
  // setTransform): exactly when `data-gesture` appears. Ends with onSettle.
  onMotionStart(fn: () => void): () => void;
  onChange(fn: (t: Transform) => void): () => void; // at most once per animation frame
  onSettle(fn: (t: Transform) => void): () => void; // gesture and inertia idle for 100 ms
  resize(): void; // recompute bounds
  dispose(): void;
}

declare global {
  interface Window {
    // For tests: the live controller and how many transforms it has written.
    __viewer?: Controller & { readonly writes: number };
  }
}

interface Point {
  x: number;
  y: number;
}

type Gesture = "pan" | "zoom";

// rzpp defaults (rzpp-defaults.md section 2).
const DRAG_PADDING = 100; // px a drag or pinch may pull past a bound
const ALIGN_MS = 200; // align to bounds / scale after a gesture
const RETURN_MS = 400; // velocityAlignmentTime: ease back from past a bound
const PROGRAMMATIC_MS = 300; // zoomIn / zoomOut / setTransform
const CENTER_MS = 200; // centerView
const DOUBLE_CLICK_MS = 200;
const DOUBLE_CLICK_STEP = 0.7;
const WHEEL_STOP_MS = 100;
const DOUBLE_TAP_MS = 200; // a touch this soon after the last one does not pan
const SETTLE_MS = 100;
// Ctrl-wheel and pinch may dip below MIN_SCALE until they realign; the same
// floor as wheelScale's.
const OVERSHOOT_FLOOR = MIN_SCALE / 2;

// Not rzpp: a drag this far (px, either axis) swallows the click that ends it.
const CLICK_SLOP = 10;
// A swallow flag left by a drag whose click never came is dropped after this.
const SWALLOW_MS = 400;
// Release speed (px/ms) is measured over the last VELOCITY_WINDOW_MS of
// movement, and is zero if the pointer rested for HOLD_MS before lifting.
// Each interval between samples counts for at most one 60 Hz frame (FRAME_MS):
// real input arrives at the display rate or faster (and getCoalescedEvents()
// keeps the input rate through a busy frame), so the cap never binds there
// and 60 Hz and 120 Hz devices both get their true speed. A stream delivered
// late (a busy main thread, an automation harness) keeps the speed its pixel
// deltas give per frame, as rzpp's per-event delta does, instead of slowing
// down. For the same reason a rest only counts as a hold when it is also
// twice as long as the last move interval, up to MAX_HOLD_MS.
const VELOCITY_WINDOW_MS = 100;
const FRAME_MS = 1000 / 60;
const HOLD_MS = 100;
const MAX_HOLD_MS = 200;
const MAX_SAMPLES = 64;

const ease = (p: number) => 0.5 - Math.cos(Math.PI * p) / 2;

const round = (value: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
};

const same = (a: Transform, b: Transform) => a.x === b.x && a.y === b.y && a.scale === b.scale;

const valid = (t: Transform | undefined): t is Transform =>
  !!t && Number.isFinite(t.x) && Number.isFinite(t.y) && t.scale > 0 && t.scale < Infinity;

// CSS rejects nothing JS prints for finite numbers, but tiny float residue
// (1e-13) is noise: write it as 0.
const px = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v);

function emit<T>(fns: Set<(arg: T) => void>, arg: T): void {
  for (const fn of fns) {
    try {
      fn(arg);
    } catch (error) {
      reportError(error);
    }
  }
}

function subscribe<F>(fns: Set<F>, fn: F): () => void {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
}

interface Drag {
  id: number;
  down: Point; // client px of the pointerdown
  start: Point; // client px where the drag (or its last rebase) began
  from: Transform;
  moved: boolean;
  far: boolean; // moved CLICK_SLOP or more on an axis since the pointerdown
  samples: { x: number; y: number; t: number }[];
}

interface Pinch {
  a: number;
  b: number;
  dist: number;
  scale: number;
  anchor: Point; // canvas point under the starting midpoint
  mid: Point; // latest midpoint, viewer px
}

interface Glide {
  v: Point; // px/ms, decayed in place by inertia()
  last: number;
  start: number;
  // An axis released past its bound eases back instead of gliding.
  rx: { from: number; to: number } | null;
  ry: { from: number; to: number } | null;
}

export function createController(
  root: HTMLElement,
  layer: HTMLElement,
  opts: { content: Size; initial?: Transform }
): Controller {
  const content = opts.content;
  const listeners = new AbortController();
  const signal = listeners.signal;

  const startFns = new Set<() => void>();
  const motionFns = new Set<() => void>();
  const changeFns = new Set<(t: Transform) => void>();
  const settleFns = new Set<(t: Transform) => void>();

  // Layout is read only here, in resize() and in the ResizeObserver callback.
  let viewport: Size = { w: 0, h: 0 };
  let origin: Point = { x: 0, y: 0 };
  function measure(): boolean {
    const rect = root.getBoundingClientRect();
    origin = { x: rect.left, y: rect.top };
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === viewport.w && h === viewport.h) return false;
    viewport = { w, h };
    return true;
  }
  measure();

  // boot-view already painted window.__boot for the viewport it recorded, so
  // the first frame only writes when that is not what should be shown. A deep
  // link may sit past the bounds (as with rzpp's setTransform); it is only
  // clamped when the viewport changed in between.
  const boot = window.__boot;
  const bootViewport = window.__bootViewport;
  const initial = valid(opts.initial) ? opts.initial : valid(boot) ? boot : undefined;
  const unchanged = !!bootViewport && bootViewport.w === viewport.w && bootViewport.h === viewport.h;
  let t: Transform = !initial
    ? centerTransform(viewport, content, 1)
    : unchanged
      ? { x: initial.x, y: initial.y, scale: initial.scale }
      : clampTransform(initial, viewport, content);
  let shown: Transform | null = valid(boot) ? boot : null;
  let writes = 0;

  let raf = 0;
  let tween: { from: Transform; to: Transform; ms: number; start: number } | null = null;
  let glide: Glide | null = null;

  const pointers = new Map<number, Point>();
  let drag: Drag | null = null;
  let pinch: Pinch | null = null;
  let safari: { scale: number; at: Point } | null = null;
  let lastTouchDown = -Infinity;

  let wheelTimer = 0;
  let wheelAt: Point = { x: 0, y: 0 };
  let doubleClickTimer = 0;
  let swallow = false;
  let swallowTimer = 0;

  let gesture: Gesture | null = null;
  let active = false;
  let userActive = false;
  let settleTimer = 0;

  const local = (e: { clientX: number; clientY: number }): Point => ({
    x: e.clientX - origin.x,
    y: e.clientY - origin.y,
  });
  const middle = (): Point => ({ x: viewport.w / 2, y: viewport.h / 2 });

  function schedule(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function write(): void {
    if (shown && same(t, shown)) return;
    // rzpp's 2D translate: translate3d blurs scaled SVG in Safari.
    layer.style.transform = `translate(${px(t.x)}px, ${px(t.y)}px) scale(${t.scale})`;
    shown = t;
    writes += 1;
    emit(changeFns, { x: t.x, y: t.y, scale: t.scale });
  }

  function frame(now: number): void {
    raf = 0;
    if (tween) {
      const p = tween.ms > 0 ? Math.min(1, Math.max(0, (now - tween.start) / tween.ms)) : 1;
      if (p >= 1) {
        t = tween.to;
        tween = null;
      } else {
        const k = ease(p);
        const { from, to } = tween;
        t = {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          scale: from.scale + (to.scale - from.scale) * k,
        };
      }
    } else if (glide) {
      stepGlide(glide, now);
    }
    write();
    if (tween || glide) schedule();
    else idle();
  }

  // Release inertia (rzpp handleVelocityPanning): a flick that starts inside
  // the bounds stops hard at them; an axis already past a bound eases back.
  function stepGlide(g: Glide, now: number): void {
    const dt = Math.min(100, Math.max(0, now - g.last));
    g.last = now;
    const { dx, dy, done } = inertia(g.v, dt);
    const b = boundsFor(viewport, content, t.scale);
    const k = ease(Math.min(1, Math.max(0, (now - g.start) / RETURN_MS)));
    let x = t.x + dx;
    let y = t.y + dy;
    if (g.rx) {
      x = g.rx.from + (g.rx.to - g.rx.from) * k;
      if (k >= 1) g.rx = null;
    } else if (x < b.minX || x > b.maxX) {
      x = x < b.minX ? b.minX : b.maxX;
      g.v.x = 0;
    }
    if (g.ry) {
      y = g.ry.from + (g.ry.to - g.ry.from) * k;
      if (k >= 1) g.ry = null;
    } else if (y < b.minY || y > b.maxY) {
      y = y < b.minY ? b.minY : b.maxY;
      g.v.y = 0;
    }
    t = { x, y, scale: t.scale };
    if (done && !g.rx && !g.ry) glide = null;
  }

  function begin(kind: Gesture, user: boolean): void {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = 0;
    }
    active = true;
    if (gesture !== kind) {
      const idleBefore = gesture === null;
      gesture = kind;
      root.dataset.gesture = kind;
      if (idleBefore) emit(motionFns, undefined);
    }
    if (user && !userActive) {
      userActive = true;
      emit(startFns, undefined);
    }
  }

  // Starts the settle countdown once nothing is moving or held.
  function idle(): void {
    if (!active || settleTimer || raf || tween || glide || pinch || safari || wheelTimer || pointers.size) return;
    settleTimer = window.setTimeout(settle, SETTLE_MS);
  }

  function settle(): void {
    settleTimer = 0;
    active = false;
    userActive = false;
    gesture = null;
    root.removeAttribute("data-gesture");
    emit(settleFns, { x: t.x, y: t.y, scale: t.scale });
  }

  function animateTo(target: Transform, ms: number, kind: Gesture, user = false): void {
    glide = null;
    if (same(target, t)) {
      tween = null;
      return;
    }
    begin(kind, user);
    if (ms > 0) {
      tween = { from: t, to: target, ms, start: performance.now() };
    } else {
      tween = null;
      t = target;
    }
    schedule();
  }

  // rzpp handleAlignToScaleBounds: back to MIN_SCALE about `anchor` if a
  // ctrl-wheel or pinch overshot it, then into the bounds, over 200 ms.
  function align(anchor: Point, kind: Gesture): void {
    const target = clampTransform(zoomAt(t, anchor, clampScale(t.scale)), viewport, content);
    animateTo(target, ALIGN_MS, kind);
  }

  // Bounds plus the overshoot a drag or pinch may pull (rzpp
  // getMouseBoundedPosition with the 100 px padding, none below MIN_SCALE).
  function padded(next: Transform): Transform {
    const pad = next.scale >= MIN_SCALE ? DRAG_PADDING : 0;
    const b = boundsFor(viewport, content, next.scale);
    return {
      x: Math.min(b.maxX + pad, Math.max(b.minX - pad, next.x)),
      y: Math.min(b.maxY + pad, Math.max(b.minY - pad, next.y)),
      scale: next.scale,
    };
  }

  function rebase(): void {
    if (drag) {
      const p = pointers.get(drag.id);
      if (p) drag.start = { x: p.x, y: p.y };
      drag.from = t;
    }
    if (pinch) {
      const a = pointers.get(pinch.a);
      const b = pointers.get(pinch.b);
      if (a && b) {
        pinch.dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        pinch.mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      }
      pinch.scale = t.scale;
      pinch.anchor = { x: (pinch.mid.x - t.x) / t.scale, y: (pinch.mid.y - t.y) / t.scale };
    }
  }

  function capture(id: number): void {
    try {
      root.setPointerCapture(id);
    } catch {
      // The pointer is already gone; its up or cancel ends the drag.
    }
  }

  function uncapture(id: number): void {
    try {
      if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
    } catch {
      // Nothing to release.
    }
  }

  function armSwallowTimeout(): void {
    clearTimeout(swallowTimer);
    swallowTimer = window.setTimeout(() => {
      swallow = false;
    }, SWALLOW_MS);
  }

  function clearSwallow(): void {
    swallow = false;
    clearTimeout(swallowTimer);
  }

  // Speed over the last VELOCITY_WINDOW_MS of movement (px/ms), each interval
  // capped at FRAME_MS; null when the pointer rested before lifting.
  function releaseVelocity(d: Drag, upTime: number): Point | null {
    const s = d.samples;
    const n = s.length;
    if (n < 2) return null;
    const last = s[n - 1];
    const cadence = last.t - s[n - 2].t;
    if (upTime - last.t > Math.min(MAX_HOLD_MS, Math.max(HOLD_MS, 2 * cadence))) return null;
    let dx = 0;
    let dy = 0;
    let dt = 0;
    for (let i = n - 1; i > 0 && dt < VELOCITY_WINDOW_MS; i--) {
      const gap = s[i].t - s[i - 1].t;
      // A rest during the drag: only the movement after it counts.
      if (gap > HOLD_MS && i < n - 1) break;
      dx += s[i].x - s[i - 1].x;
      dy += s[i].y - s[i - 1].y;
      dt += Math.min(FRAME_MS, Math.max(0, gap));
    }
    return dt > 0 ? { x: dx / dt, y: dy / dt } : null;
  }

  // rzpp handlePanningEnd: inertia for a fast release when the canvas is
  // larger than the viewer, otherwise a 200 ms align to bounds.
  function release(d: Drag, upTime: number): void {
    const v = releaseVelocity(d, upTime);
    const zoomed = content.w * t.scale > viewport.w || content.h * t.scale > viewport.h;
    if (!v || !(Math.hypot(v.x, v.y) > INERTIA_START_SPEED) || !zoomed || t.scale < MIN_SCALE) {
      align(middle(), "pan");
      return;
    }
    const b = boundsFor(viewport, content, t.scale);
    const past = (value: number, min: number, max: number) =>
      value > max ? { from: value, to: max } : value < min ? { from: value, to: min } : null;
    const rx = past(t.x, b.minX, b.maxX);
    const ry = past(t.y, b.minY, b.maxY);
    const now = performance.now();
    tween = null;
    glide = { v: { x: rx ? 0 : v.x, y: ry ? 0 : v.y }, last: now, start: now, rx, ry };
    begin("pan", false);
    schedule();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const next = wheelScale(t.scale, e.deltaY, e.ctrlKey);
    if (next === t.scale) return;
    if (!wheelTimer) {
      // A new burst takes over from any running animation.
      tween = null;
      glide = null;
    }
    wheelAt = local(e);
    t = zoomAt(t, wheelAt, next);
    rebase();
    begin("zoom", true);
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(onWheelStop, WHEEL_STOP_MS);
    schedule();
  }

  function onWheelStop(): void {
    wheelTimer = 0;
    // A drag or pinch in progress aligns when it ends.
    if (!drag && !pinch) align(wheelAt, "zoom");
    idle();
  }

  function onPointerDownCapture(): void {
    // A new gesture: a stale swallow flag must never eat its click.
    if (!pointers.size) clearSwallow();
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.isPrimary && pointers.size) reset();
    if (pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tween = null;
    glide = null;
    if (pointers.size === 1) {
      const touch = e.pointerType === "touch";
      const doubleTap = touch && e.timeStamp - lastTouchDown < DOUBLE_TAP_MS;
      if (touch) lastTouchDown = e.timeStamp;
      drag = doubleTap
        ? null
        : {
            id: e.pointerId,
            down: { x: e.clientX, y: e.clientY },
            start: { x: e.clientX, y: e.clientY },
            from: t,
            moved: false,
            far: false,
            samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
          };
    } else if (!pinch) {
      startPinch();
    }
  }

  // A second pointer turns the gesture into a pinch: the drag (and with it
  // its inertia and pending tap) is cancelled.
  function startPinch(): void {
    const [a, b] = pointers.keys();
    const pa = pointers.get(a)!;
    const pb = pointers.get(b)!;
    drag = null;
    swallow = true;
    clearTimeout(swallowTimer);
    const mid = local({ clientX: (pa.x + pb.x) / 2, clientY: (pa.y + pb.y) / 2 });
    pinch = {
      a,
      b,
      dist: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      scale: t.scale,
      anchor: { x: (mid.x - t.x) / t.scale, y: (mid.y - t.y) / t.scale },
      mid,
    };
    begin("zoom", true);
  }

  // rzpp handlePinchZoom: scale by the finger distance (2 dp), keeping the
  // canvas point under the starting midpoint under the current midpoint.
  function movePinch(p: Pinch): void {
    const a = pointers.get(p.a)!;
    const b = pointers.get(p.b)!;
    const ratio = Math.hypot(a.x - b.x, a.y - b.y) / p.dist;
    const scale = Math.min(MAX_SCALE, Math.max(OVERSHOOT_FLOOR, round(p.scale * ratio, 2)));
    p.mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    t = padded({ x: p.mid.x - p.anchor.x * scale, y: p.mid.y - p.anchor.y * scale, scale });
    schedule();
  }

  function onPointerMove(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerType === "mouse" && e.buttons === 0) {
      // The button came up where we did not see it.
      end(e.pointerId, e.timeStamp, false);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch) {
      if (e.pointerId === pinch.a || e.pointerId === pinch.b) movePinch(pinch);
      return;
    }
    const d = drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    const s = d.samples;
    const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const c of coalesced.length ? coalesced : [e]) s.push({ x: c.clientX, y: c.clientY, t: c.timeStamp });
    if (s.length > MAX_SAMPLES) s.splice(0, s.length - MAX_SAMPLES);
    if (!d.moved) {
      if (!dx && !dy) return;
      d.moved = true;
      begin("pan", true);
    }
    if (!d.far && (Math.abs(e.clientX - d.down.x) >= CLICK_SLOP || Math.abs(e.clientY - d.down.y) >= CLICK_SLOP)) {
      d.far = true;
      capture(d.id);
    }
    t = padded({ x: d.from.x + dx, y: d.from.y + dy, scale: t.scale });
    schedule();
  }

  function onPointerUp(e: PointerEvent): void {
    end(e.pointerId, e.timeStamp, e.type === "pointercancel");
  }

  function onLostCapture(e: PointerEvent): void {
    // Only our own capture counts: the implicit touch capture on a sticker is
    // lost (and bubbles here) as soon as we capture to the root.
    if (e.target === root && pointers.has(e.pointerId)) end(e.pointerId, e.timeStamp, true);
  }

  function end(id: number, time: number, cancelled: boolean): void {
    if (!pointers.delete(id)) return;
    uncapture(id);
    if (pinch && (id === pinch.a || id === pinch.b)) {
      // The finger left behind stays inert until it lifts.
      const mid = pinch.mid;
      pinch = null;
      align(mid, "zoom");
    } else if (drag && drag.id === id) {
      const d = drag;
      drag = null;
      if (d.far) {
        swallow = true;
        clearTimeout(swallowTimer);
      }
      if (d.moved && !cancelled) release(d, time);
    }
    if (!pointers.size) {
      if (swallow) armSwallowTimeout();
      if (!tween && !glide && !wheelTimer && !safari) align(middle(), gesture ?? "pan");
    }
    idle();
  }

  // Drops every pointer (window blur, a stale pointer, dispose); what was
  // being dragged aligns back into the bounds.
  function reset(): void {
    for (const id of pointers.keys()) uncapture(id);
    pointers.clear();
    drag = null;
    pinch = null;
    safari = null;
  }

  function onBlur(): void {
    const held = pointers.size > 0 || safari !== null;
    reset();
    if (held && !tween && !glide && !wheelTimer) align(middle(), gesture ?? "pan");
    idle();
  }

  // A hidden page runs no frames: finish everything now so no gesture state
  // survives until the page is shown again.
  function onVisibility(): void {
    if (document.visibilityState !== "hidden") return;
    const anchor = pinch?.mid ?? safari?.at ?? wheelAt;
    reset();
    // Nothing moved since the last settle (or the boot view): leave it as is.
    if (!active) return;
    if (tween) t = tween.to;
    tween = null;
    glide = null;
    if (wheelTimer) {
      clearTimeout(wheelTimer);
      wheelTimer = 0;
    }
    t = clampTransform(zoomAt(t, anchor, clampScale(t.scale)), viewport, content);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    write();
    clearTimeout(settleTimer);
    settle();
  }

  function onClickCapture(e: MouseEvent): void {
    // Keyboard activations (detail 0) are never the end of a drag.
    if (!swallow || e.detail === 0) return;
    clearSwallow();
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // rzpp handleDoubleClick: zoom in by exp(0.7) about the pointer, ignoring
  // a double click during the previous one's animation.
  function onDoubleClick(e: MouseEvent): void {
    if (doubleClickTimer) return;
    const scale = clampScale(round(round(t.scale * Math.exp(DOUBLE_CLICK_STEP), 3), 2));
    if (scale === t.scale) return;
    doubleClickTimer = window.setTimeout(() => {
      doubleClickTimer = 0;
    }, DOUBLE_CLICK_MS);
    animateTo(clampTransform(zoomAt(t, local(e), scale), viewport, content), DOUBLE_CLICK_MS, "zoom", true);
  }

  // Safari's trackpad pinch arrives as gesture events (no pointers down); on
  // iOS the fingers are pointers already, so only preventDefault there.
  type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
  function onGestureStart(e: Event): void {
    e.preventDefault();
    if (pointers.size) return;
    const g = e as GestureEvent;
    safari = { scale: t.scale, at: local(g) };
    tween = null;
    glide = null;
    begin("zoom", true);
  }

  function onGestureChange(e: Event): void {
    e.preventDefault();
    if (!safari) return;
    const ratio = (e as GestureEvent).scale;
    if (!(ratio > 0 && ratio < Infinity)) return;
    const scale = Math.min(MAX_SCALE, Math.max(OVERSHOOT_FLOOR, round(safari.scale * ratio, 2)));
    t = zoomAt(t, safari.at, scale);
    schedule();
  }

  function onGestureEnd(e: Event): void {
    e.preventDefault();
    if (!safari) return;
    const at = safari.at;
    safari = null;
    align(at, "zoom");
    idle();
  }

  // rzpp's resize handling: cancel the animation and clamp at once (never
  // re-centre). An interrupted tween jumps to its clamped target.
  function onResize(): void {
    if (!measure()) return;
    if (tween) t = tween.to;
    tween = null;
    glide = null;
    if (t.scale >= MIN_SCALE) t = clampTransform(t, viewport, content);
    rebase();
    schedule();
  }

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(root);

  const passive = { passive: true, signal };
  const nonPassive = { passive: false, signal };
  root.addEventListener("wheel", onWheel, nonPassive);
  root.addEventListener("pointerdown", onPointerDown, passive);
  root.addEventListener("lostpointercapture", onLostCapture, passive);
  root.addEventListener("dblclick", onDoubleClick, passive);
  root.addEventListener("gesturestart", onGestureStart, nonPassive);
  root.addEventListener("gesturechange", onGestureChange, nonPassive);
  root.addEventListener("gestureend", onGestureEnd, nonPassive);
  window.addEventListener("pointerdown", onPointerDownCapture, { capture: true, passive: true, signal });
  window.addEventListener("pointermove", onPointerMove, passive);
  window.addEventListener("pointerup", onPointerUp, passive);
  window.addEventListener("pointercancel", onPointerUp, passive);
  // Not passive: it cancels the click that ends a drag.
  window.addEventListener("click", onClickCapture, { capture: true, signal });
  window.addEventListener("blur", onBlur, passive);
  document.addEventListener("visibilitychange", onVisibility, passive);

  if (!shown || !same(t, shown)) schedule();

  const api: Controller & { readonly writes: number } = {
    get transform() {
      return { x: t.x, y: t.y, scale: t.scale };
    },
    get writes() {
      return writes;
    },
    setTransform(next, options) {
      if (!valid(next)) return;
      const target = clampTransform(next, viewport, content);
      animateTo(target, options?.animateMs ?? PROGRAMMATIC_MS, target.scale === t.scale ? "pan" : "zoom");
    },
    zoomBy(factor, anchor) {
      if (!(factor > 0 && factor < Infinity)) return;
      const scale = clampScale(round(round(t.scale * factor, 3), 2));
      animateTo(clampTransform(zoomAt(t, anchor ?? middle(), scale), viewport, content), PROGRAMMATIC_MS, "zoom");
    },
    center() {
      animateTo(centerTransform(viewport, content, t.scale), CENTER_MS, "pan");
    },
    onGestureStart: (fn) => subscribe(startFns, fn),
    onMotionStart: (fn) => subscribe(motionFns, fn),
    onChange: (fn) => subscribe(changeFns, fn),
    onSettle: (fn) => subscribe(settleFns, fn),
    resize: onResize,
    dispose() {
      listeners.abort();
      resizeObserver.disconnect();
      reset();
      cancelAnimationFrame(raf);
      raf = 0;
      tween = null;
      glide = null;
      for (const timer of [wheelTimer, doubleClickTimer, swallowTimer, settleTimer]) clearTimeout(timer);
      wheelTimer = doubleClickTimer = swallowTimer = settleTimer = 0;
      swallow = false;
      active = userActive = false;
      gesture = null;
      root.removeAttribute("data-gesture");
      startFns.clear();
      motionFns.clear();
      changeFns.clear();
      settleFns.clear();
      if (window.__viewer === api) delete window.__viewer;
    },
  };
  window.__viewer = api;
  return api;
}
