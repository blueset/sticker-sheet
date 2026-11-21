// Helpers shared by the Playwright benches. The benches are Chromium-only (CDP
// throttling and tracing) and only run with BENCH=1.
import os from "node:os";
import type { Browser, CDPSession } from "@playwright/test";
import { PROFILES, type Profile } from "./profiles.ts";
import type { ProfileName, RunMeta } from "./results.ts";

export const STICKER_COUNT = 63;
export const BENCH_RUNS = Number(process.env.BENCH_RUNS ?? 5);
// First run number. Above 1, earlier runs of the label are kept, so A/B arms
// can alternate one run per invocation (BENCH_RUNS=1, BENCH_RUN_FROM=1..n).
export const BENCH_RUN_FROM = Number(process.env.BENCH_RUN_FROM ?? 1);

export const benchEnabled = () => process.env.BENCH === "1";

export function profileOf(projectName: string): ProfileName | null {
  if (projectName === "chromium-mobile") return "mobile";
  if (projectName === "chromium-desktop") return "desktop";
  return null;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// CPU and network throttling for the whole page target. Must run before the
// first navigation; the mobile profile is the literal values in profiles.ts.
export async function applyProfile(
  cdp: CDPSession,
  profile: Profile
): Promise<void> {
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: profile.cpuSlowdown,
  });
  if (profile.network) {
    await cdp.send("Network.emulateNetworkConditions", profile.network);
  }
}

// A/B probe hook: CSS injected after the page is loaded and idle, before the
// gesture starts. `{stickers}` and `{layer}` expand to the contract selectors,
// e.g. BENCH_PROBE_CSS="{stickers}{filter:none !important}" with
// BENCH_LABEL=probe-no-filter. Empty for normal runs.
export const probeCss = (selectors: { stickers: string; layer: string }) =>
  (process.env.BENCH_PROBE_CSS ?? "")
    .replaceAll("{stickers}", selectors.stickers)
    .replaceAll("{layer}", selectors.layer);

// Query appended to the benches' (and settle-crisp.spec's) `page.goto`, e.g.
// BENCH_QUERY='?v=settle:none' to measure a tuning variant served from a
// PUBLIC_VARIANTS=1 build. Empty for normal runs.
export const benchQuery = () => process.env.BENCH_QUERY ?? "";
export const benchUrl = () => `/${benchQuery()}`;

export function runMeta(
  label: string,
  name: ProfileName,
  browser: Browser
): RunMeta {
  const profile = PROFILES[name];
  return {
    label,
    profile: name,
    chromium: browser.version(),
    node: process.version,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    memGb: Math.round(os.totalmem() / 2 ** 30),
    cpuSlowdown: profile.cpuSlowdown,
    network: profile.network,
    runs: BENCH_RUNS,
    recordedAt: new Date().toISOString(),
    ...(process.env.BENCH_PROBE_CSS
      ? { probeCss: process.env.BENCH_PROBE_CSS }
      : {}),
    ...(process.env.BENCH_PROBE_IMAGES
      ? { probeImages: process.env.BENCH_PROBE_IMAGES }
      : {}),
    query: benchQuery(),
  };
}
