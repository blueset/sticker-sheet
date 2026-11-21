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

// shadow: s0 = the live CSS filter (default), s1 = pre-baked sprites
// (`npm run shadows`), s2 = a box shadow on box-shaped stickers plus the live
// filter on the rest. s1/s2 exist only in tuning builds (PUBLIC_VARIANTS=1)
// so the default main bundle stays byte-identical. (Tailwind scans this
// file: no utility names here.)
const VALUES: Record<VariantFactor, readonly string[]> = {
  shadow: import.meta.env.PUBLIC_VARIANTS === "1" ? ["s0", "s1", "s2"] : ["s0"],
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
