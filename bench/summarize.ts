// Aggregates raw bench runs into medians and p95 and writes the committed
// `bench/results/<label>-<profile>.json`.
//
//   node bench/summarize.ts <label> <profile>   e.g. node bench/summarize.ts baseline mobile
//
// Raw runs live in the gitignored `bench/results/tmp/<label>-<profile>/`. The
// benches call `writeSummary` themselves when they finish, so the CLI is only
// needed to re-summarise. `label` is `TARGET` (or `BENCH_LABEL`) at bench time:
// `baseline`, `new`, ...
import fs from "node:fs";
import path from "node:path";
import {
  readRaw,
  summaryPath,
  type FirstRenderResult,
  type GestureResult,
  type ProfileName,
  type RunMeta,
} from "./results.ts";
import { percentile } from "./metrics.ts";

export interface Stat {
  // Runs that produced a number / runs that produced null.
  n: number;
  nulls: number;
  // Nearest-rank p50 and p95 over the non-null runs (exact median when n is odd).
  median: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
  // (max - min) / median, in percent: the run-to-run noise at a glance.
  spreadPct: number | null;
  values: Array<number | null>;
}

export type StatTree = { [key: string]: Stat | StatTree };

export interface Summary {
  label: string;
  profile: ProfileName;
  meta: RunMeta | null;
  runs: { firstRender: number; gestures: Record<string, number> };
  firstRender: StatTree | null;
  gestures: Record<string, StatTree>;
  raw: { firstRender: FirstRenderResult[]; gestures: GestureResult[] };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function stat(values: Array<number | null>): Stat {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return {
      n: 0,
      nulls: values.length,
      median: null,
      p95: null,
      min: null,
      max: null,
      spreadPct: null,
      values,
    };
  }
  const median = percentile(present, 50);
  const min = Math.min(...present);
  const max = Math.max(...present);
  return {
    n: present.length,
    nulls: values.length - present.length,
    median: round(median),
    p95: round(percentile(present, 95)),
    min: round(min),
    max: round(max),
    spreadPct:
      median !== 0
        ? round(((max - min) / Math.abs(median)) * 100)
        : max === min
          ? 0
          : null,
    values: values.map((v) => (v === null ? null : round(v))),
  };
}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Every numeric (or null) field becomes a Stat; nested objects (`bytes`)
// recurse; strings, arrays and other detail are skipped.
export function statsOf(rows: Row[]): StatTree {
  const keys = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k);
  const tree: StatTree = {};
  for (const key of keys) {
    const column = rows.map((r) => r[key]);
    if (column.some(isRow)) {
      tree[key] = statsOf(column.filter(isRow));
    } else if (column.every((v) => v === null || v === undefined || typeof v === "number")) {
      if (column.some((v) => typeof v === "number" || v === null)) {
        tree[key] = stat(column.map((v) => (typeof v === "number" ? v : null)));
      }
    }
  }
  return tree;
}

export function summarizeRuns(input: {
  label: string;
  profile: ProfileName;
  meta: RunMeta | null;
  firstRender: FirstRenderResult[];
  gestures: GestureResult[];
}): Summary {
  const byName = new Map<string, GestureResult[]>();
  for (const g of input.gestures) {
    byName.set(g.name, [...(byName.get(g.name) ?? []), g]);
  }
  const gestures: Record<string, StatTree> = {};
  const gestureRuns: Record<string, number> = {};
  for (const [name, runs] of byName) {
    gestures[name] = statsOf(runs as unknown as Row[]);
    gestureRuns[name] = runs.length;
  }
  return {
    label: input.label,
    profile: input.profile,
    meta: input.meta,
    runs: { firstRender: input.firstRender.length, gestures: gestureRuns },
    firstRender: input.firstRender.length
      ? statsOf(input.firstRender as unknown as Row[])
      : null,
    gestures,
    raw: { firstRender: input.firstRender, gestures: input.gestures },
  };
}

export function summarize(label: string, profile: ProfileName): Summary {
  const meta = readRaw<RunMeta>(label, profile, "meta")[0] ?? null;
  return summarizeRuns({
    label,
    profile,
    meta,
    firstRender: readRaw<FirstRenderResult>(label, profile, "first-render-"),
    gestures: readRaw<GestureResult>(label, profile, "gesture-"),
  });
}

export function writeSummary(label: string, profile: ProfileName): string {
  const summary = summarize(label, profile);
  const file = summaryPath(label, profile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summary, null, 2) + "\n");
  return file;
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("bench/summarize.ts");
if (isCli) {
  const [label, profile] = process.argv.slice(2);
  if (!label || (profile !== "mobile" && profile !== "desktop")) {
    console.error("usage: node bench/summarize.ts <label> <mobile|desktop>");
    process.exit(1);
  }
  console.log(`wrote ${writeSummary(label, profile)}`);
}
