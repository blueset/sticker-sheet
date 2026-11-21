import { gzipSync } from "node:zlib";

// Nearest-rank percentile: the smallest value with at least p% of the data at
// or below it. For an odd number of runs, percentile(values, 50) is the exact
// median.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new RangeError("percentile of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  // The epsilon keeps products like 0.07 * 100 from rounding up a rank.
  const rank = Math.ceil((p * sorted.length) / 100 - 1e-9);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

// Size of the buffer once gzipped at level 9. Used for every payload figure so
// baseline and rewrite are compared with the same compressor.
export function gzipBytes(buf: Uint8Array): number {
  return gzipSync(buf, { level: 9 }).length;
}

// A long task is a main-thread task over 50 ms, as reported by the `longtask`
// PerformanceObserver. Tuples are [startMs, durationMs].
export type LongTask = [number, number];

export const LONG_TASK_MS = 50;
export const QUIET_WINDOW_MS = 5000;

// Lighthouse-style quiet-window time-to-interactive, without the network-quiet
// condition. Start at FCP; while the next long task starts less than 5 s after
// the end of the current candidate, move the candidate to that task's end.
export function ttiProxy(fcp: number, longTasks: LongTask[]): number {
  let candidate = fcp;
  for (const [start, dur] of [...longTasks].sort((a, b) => a[0] - b[0])) {
    if (start + dur <= candidate) continue;
    if (start - candidate >= QUIET_WINDOW_MS) break;
    candidate = start + dur;
  }
  return candidate;
}

// Total blocking time over [fcp, tti]: each long task is clipped to the window
// and contributes its clipped duration minus 50 ms.
export function totalBlockingTime(
  fcp: number,
  tti: number,
  longTasks: LongTask[]
): number {
  let tbt = 0;
  for (const [start, dur] of longTasks) {
    const from = Math.max(start, fcp);
    const to = Math.min(start + dur, tti);
    if (to > from) tbt += Math.max(0, to - from - LONG_TASK_MS);
  }
  return tbt;
}
