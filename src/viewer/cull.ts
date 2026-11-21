// `cull:explicit`: instead of `content-visibility: auto`, stickers wholly
// outside the viewport get `data-cull` at settle (CSS hides them) and lose it
// at gesture start. Uses one getBoundingClientRect per sticker per settle, so
// rotation is accounted for. The focused sticker is never culled.
export interface Cull {
  onGestureStart(): void;
  onSettle(): void;
}

export function createCull(root: HTMLElement, layer: HTMLElement): Cull {
  let stickers: HTMLElement[] | null = null;
  const all = () => (stickers ??= Array.from(layer.querySelectorAll<HTMLElement>(".sticker")));
  return {
    onGestureStart() {
      for (const el of all()) el.removeAttribute("data-cull");
    },
    onSettle() {
      const v = root.getBoundingClientRect();
      const focused = document.activeElement;
      const rects = all().map((el) => el.getBoundingClientRect());
      all().forEach((el, i) => {
        const r = rects[i]!;
        const outside = r.right < v.left || r.left > v.right || r.bottom < v.top || r.top > v.bottom;
        el.toggleAttribute("data-cull", outside && el !== focused);
      });
    },
  };
}
