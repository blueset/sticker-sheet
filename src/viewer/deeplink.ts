// A `#slug` deep link opens the Sheet at first idle. Start its chunk and the
// description now, so neither is fetched only when the island hydrates.
import { appStore } from "../lib/appState";
import { prefetchDescription } from "./prefetch";

let slug: string | null = null;
try {
  slug = decodeURIComponent(location.hash.slice(1));
} catch {
  // A malformed hash names no sticker.
}
if (slug && document.querySelector(`button.sticker[data-slug="${CSS.escape(slug)}"]`)) {
  import("../islands/Sheet").catch(() => {});
  void prefetchDescription(slug, appStore.getState().language);
}
