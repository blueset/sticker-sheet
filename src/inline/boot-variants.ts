import { applyVariants } from "../viewer/variants";

// Only shipped when the build sets PUBLIC_VARIANTS=1, so CSS-only variants
// are in place before first paint.
try {
  applyVariants(document.documentElement, location.search);
} catch {
  // The defaults are the markup's behaviour.
}
