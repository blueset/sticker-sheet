// Runs in <head> after boot-head, which has already set `html[lang]`. The CJK
// @font-face stylesheet is large, so it is only requested once a language that
// needs it is shown, now or after a later switch.
const root = document.documentElement;
const href = (document.currentScript as HTMLScriptElement | null)?.dataset.href;

let observer: MutationObserver | undefined;

function load(): void {
  if (!href || root.lang === "en") return;
  observer?.disconnect();
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

load();
if (href && root.lang === "en") {
  observer = new MutationObserver(load);
  observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
}
