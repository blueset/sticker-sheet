import { describe, expect, it } from "vitest";
import {
  CRITICAL_JS_BUDGET,
  criticalJsGateValue,
  gzipBytes,
  payloadMarkers,
  percentile,
  totalBlockingTime,
  ttiProxy,
  type LongTask,
} from "./metrics.ts";

describe("percentile (nearest rank)", () => {
  it("returns the nearest-rank value", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it("sorts without mutating the input", () => {
    const values = [9, 1, 5, 3, 7];
    expect(percentile(values, 50)).toBe(5);
    expect(values).toEqual([9, 1, 5, 3, 7]);
  });

  it("clamps to the min and max", () => {
    expect(percentile([4, 2, 8], 0)).toBe(2);
    expect(percentile([4, 2, 8], 100)).toBe(8);
  });

  it("rejects empty input", () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe("gzipBytes", () => {
  it("compresses repetitive input far below its raw size", () => {
    const raw = new Uint8Array(10_000).fill(65);
    const gz = gzipBytes(raw);
    expect(gz).toBeGreaterThan(0);
    expect(gz).toBeLessThan(100);
  });

  it("is deterministic", () => {
    const raw = new TextEncoder().encode("function a(){return 1}".repeat(50));
    expect(gzipBytes(raw)).toBe(gzipBytes(raw));
  });
});

describe("payloadMarkers", () => {
  it("names each library whose marker occurs and nothing else", () => {
    expect(payloadMarkers('n[`__reactContainer$`+r];e.setAttribute("data-radix-x","")')).toEqual([
      "react-dom",
      "radix",
    ]);
    expect(payloadMarkers("customElements.define(`baseline-status`,X);L.leaflet-container")).toEqual([
      "leaflet",
      "baseline-status",
    ]);
    expect(payloadMarkers('const __vite__mapDeps=["_astro/react-dom.x.js","_astro/Sheet.y.js"]')).toEqual([]);
  });
});

describe("criticalJsGateValue", () => {
  const ok = (profile: "mobile" | "desktop", runs: number[]) =>
    criticalJsGateValue(profile, runs) <= CRITICAL_JS_BUDGET;

  it("gates desktop on the median, so one racing run passes", () => {
    expect(ok("desktop", [7950, 7950, 40697, 7950, 7950])).toBe(true);
    expect(ok("desktop", [7950, 140_000, 7950])).toBe(true);
    expect(ok("desktop", [140_000, 140_000, 7950])).toBe(false);
  });

  it("gates mobile on every run", () => {
    expect(ok("mobile", [0, 0, 0])).toBe(true);
    expect(ok("mobile", [CRITICAL_JS_BUDGET])).toBe(true);
    expect(ok("mobile", [CRITICAL_JS_BUDGET + 1])).toBe(false);
    expect(ok("mobile", [0, 0, 0, 0, 140_000])).toBe(false);
  });

  it("rejects an empty run list", () => {
    expect(() => criticalJsGateValue("desktop", [])).toThrow();
  });
});

describe("ttiProxy / totalBlockingTime", () => {
  // [start, duration]
  const tasks: LongTask[] = [
    [500, 120], // before FCP
    [1000, 200], // after FCP
    [1300, 80],
    [9000, 400], // more than 5 s of quiet after 1380: not part of the chain
  ];

  it("chains long tasks until a 5 s quiet window", () => {
    expect(ttiProxy(900, tasks)).toBe(1380);
  });

  it("is the FCP when nothing blocks after it", () => {
    expect(ttiProxy(2000, [[100, 80]])).toBe(2000);
    expect(ttiProxy(2000, [])).toBe(2000);
  });

  it("sums (clipped duration - 50) over [fcp, tti]", () => {
    // 200 -> 150, 80 -> 30; the task before FCP and after TTI are excluded.
    expect(totalBlockingTime(900, 1380, tasks)).toBe(180);
  });

  it("clips a task that straddles FCP and drops clipped tasks under 50 ms", () => {
    // Window [1000, 1500]: 100 ms task starting at 950 keeps 50 ms -> 0.
    expect(totalBlockingTime(1000, 1500, [[950, 100]])).toBe(0);
    expect(totalBlockingTime(1000, 1500, [[900, 300]])).toBe(150);
  });
});
