// Tuning-matrix switches: `?v=shadow:s0,settle:none,cull:cv,bg:png`. Pure
// parsing, so the same code runs in the optional head snippet and in main.ts.
export const VARIANT_DEFAULTS = {
  shadow: "s0",
  settle: "drop-will-change",
  cull: "cv",
  bg: "png",
} as const;

export type VariantFactor = keyof typeof VARIANT_DEFAULTS;
export type Variants = Record<VariantFactor, string>;

// `s0` is the only shadow value until the shadow candidates land.
const VALUES: Record<VariantFactor, readonly string[]> = {
  shadow: ["s0"],
  settle: ["drop-will-change", "retoggle-on-scale-change", "none"],
  cull: ["cv", "none", "explicit"],
  bg: ["png", "gradient"],
};

export function parseVariants(search: string): Variants {
  const out: Variants = { ...VARIANT_DEFAULTS };
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get("v");
  } catch {
    return out;
  }
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i < 0) continue;
    const factor = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (Object.hasOwn(VALUES, factor) && VALUES[factor as VariantFactor].includes(value)) {
      out[factor as VariantFactor] = value;
    }
  }
  return out;
}

// Idempotent: sets `data-v-<factor>` on `root` for every factor.
export function applyVariants(root: HTMLElement, search: string): Variants {
  const v = parseVariants(search);
  for (const factor of Object.keys(v) as VariantFactor[]) root.setAttribute(`data-v-${factor}`, v[factor]);
  return v;
}
