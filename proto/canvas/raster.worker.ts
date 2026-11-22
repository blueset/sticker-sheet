// Pathway B prototype: rasterizes an SVG sticker off the main thread.
// fetch -> Blob -> createImageBitmap(blob, resize) -> OffscreenCanvas crop ->
// transferToImageBitmap. Fails (and the page falls back to the main thread)
// in engines that cannot decode SVG blobs without a document.
interface Req {
  id: number;
  url: string;
  pw: number;
  ph: number;
  ox: number;
  oy: number;
  iw: number;
  ih: number;
}

const blobs = new Map<string, Promise<Blob>>();

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, url, pw, ph, ox, oy, iw, ih } = e.data;
  const t0 = performance.now();
  try {
    let p = blobs.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.blob());
      blobs.set(url, p);
    }
    const blob = await p;
    const img = await createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(iw)),
      resizeHeight: Math.max(1, Math.round(ih)),
      resizeQuality: "high",
    });
    const oc = new OffscreenCanvas(pw, ph);
    oc.getContext("2d")!.drawImage(img, ox, oy);
    img.close();
    const bitmap = oc.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ id, bitmap, ms: performance.now() - t0 }, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
