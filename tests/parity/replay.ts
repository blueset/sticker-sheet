import { expect, type CDPSession, type Page } from "@playwright/test";
import { contract } from "../contract.ts";

export type Op =
  | { t: "wheel"; at: [number, number]; deltaY: number }
  | { t: "drag"; from: [number, number]; by: [number, number]; ms: number }
  | { t: "dblclick"; at: [number, number] }
  | { t: "click"; control: "zoomIn" | "zoomOut" | "center" }
  | { t: "resize"; to: [number, number] };

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface GoldenEntry {
  name: string;
  ops: Op[];
  expected: Transform;
  // Bounds probes only: the unclamped position the final drag asked for, the
  // scale it was made at, and the viewport, so the maths can be replayed.
  push?: [number, number];
  scale?: number;
  viewport?: [number, number];
}

export interface GoldenProfile {
  profile: "desktop" | "mobile";
  viewport: [number, number];
  entries: GoldenEntry[];
}

export interface GoldenFile {
  profiles: GoldenProfile[];
}

// Time between synthetic pointer moves inside a drag (about one frame).
export const DRAG_STEP_MS = 16;
// Transform must be unchanged this long before the next op starts (covers the
// 100 ms wheel-stop timer plus the 200 ms alignment animation).
export const BETWEEN_OPS_QUIET_MS = 400;
// Transform must be unchanged this long before `expected` is read.
export const FINAL_QUIET_MS = 600;

export async function readTransform(page: Page): Promise<Transform> {
  return page.evaluate((selector) => {
    const layer = document.querySelector(selector);
    if (!layer) throw new Error(`layer not found: ${selector}`);
    const m = new DOMMatrix(getComputedStyle(layer).transform);
    return { x: m.e, y: m.f, scale: m.a };
  }, contract.layer);
}

// Resolves once the layer's computed transform has not changed for quietMs.
export async function settled(
  page: Page,
  quietMs: number = FINAL_QUIET_MS,
  timeoutMs = 20000
): Promise<void> {
  await page.evaluate(
    ([selector, quiet, timeout]) =>
      new Promise<void>((resolve, reject) => {
        const layer = document.querySelector(selector as string);
        if (!layer) return reject(new Error(`layer not found: ${selector}`));
        const started = performance.now();
        let last = getComputedStyle(layer).transform;
        let changedAt = started;
        const tick = () => {
          const now = performance.now();
          const current = getComputedStyle(layer).transform;
          if (current !== last) {
            last = current;
            changedAt = now;
          }
          if (now - changedAt >= (quiet as number)) return resolve();
          if (now - started > (timeout as number)) {
            return reject(new Error("transform never settled"));
          }
          setTimeout(tick, 20);
        };
        tick();
      }),
    [contract.layer, quietMs, timeoutMs] as const
  );
}

// Fresh load: centred, scale 1, nothing selected. Every golden entry starts
// from this state, so replays must reload (or otherwise reset) between entries.
export async function loadFresh(
  page: Page,
  viewport?: [number, number]
): Promise<void> {
  if (viewport) {
    await page.setViewportSize({ width: viewport[0], height: viewport[1] });
  }
  await page.goto("/");
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await settled(page);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mouseDrag(page: Page, op: Extract<Op, { t: "drag" }>) {
  const [fx, fy] = op.from;
  const [bx, by] = op.by;
  const steps = Math.max(1, Math.round(op.ms / DRAG_STEP_MS));
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      Math.round(fx + (bx * i) / steps),
      Math.round(fy + (by * i) / steps)
    );
    await sleep(op.ms / steps);
  }
  await page.mouse.up();
}

async function touchDrag(cdp: CDPSession, op: Extract<Op, { t: "drag" }>) {
  const [fx, fy] = op.from;
  const [bx, by] = op.by;
  const steps = Math.max(1, Math.round(op.ms / DRAG_STEP_MS));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fx, y: fy }],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: Math.round(fx + (bx * i) / steps),
          y: Math.round(fy + (by * i) / steps),
        },
      ],
    });
    await sleep(op.ms / steps);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

export interface ReplayOptions {
  // 'touch' replays `drag` as one-finger CDP touch input (mobile profile);
  // everything else always uses mouse input.
  input: "mouse" | "touch";
}

// Runs ops in order. Consecutive wheel ops are a ramp and run back to back;
// any other transition waits for the transform to go quiet first so each op
// starts from a resting state.
export async function replay(
  page: Page,
  ops: Op[],
  { input }: ReplayOptions
): Promise<void> {
  const cdp =
    input === "touch" ? await page.context().newCDPSession(page) : null;
  try {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const prev = ops[i - 1];
      if (prev && !(prev.t === "wheel" && op.t === "wheel")) {
        await settled(page, BETWEEN_OPS_QUIET_MS);
      }
      switch (op.t) {
        case "wheel":
          await page.mouse.move(op.at[0], op.at[1]);
          await page.mouse.wheel(0, op.deltaY);
          break;
        case "drag":
          if (cdp) await touchDrag(cdp, op);
          else await mouseDrag(page, op);
          break;
        case "dblclick":
          await page.mouse.dblclick(op.at[0], op.at[1]);
          break;
        case "click":
          await page.locator(contract.controls[op.control]).click();
          break;
        case "resize":
          await page.setViewportSize({ width: op.to[0], height: op.to[1] });
          break;
      }
    }
  } finally {
    await cdp?.detach();
  }
}
