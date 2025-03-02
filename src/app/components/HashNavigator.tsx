"use client";

import { useEffect } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { convertToCanvasCoordinates } from "../utils/coordinates";
import { ReactZoomPanPinchContext } from "react-zoom-pan-pinch";

export function HashNavigator({
  setTransform,
  instance,
}: {
  setTransform: (x: number, y: number, zoom: number) => void;
  instance: ReactZoomPanPinchContext;
}) {
  const {
    stickers,
    selectSticker,
    canvasWidth,
    canvasHeight,
    selectedSticker,
  } = useCanvasStore(
    useShallow((s) => ({
      stickers: s.stickers,
      selectSticker: s.selectSticker,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      selectedSticker: s.selectedSticker,
    }))
  );

  // Handle hash-based navigation
  useEffect(() => {
    function handleHashChange() {
      const hash = window.location.hash;

      if (!hash || hash === "#") {
        selectSticker(null);
        return;
      }

      const slug = hash.slice(1);
      if (slug) {
        const sticker = stickers.find((s) => s.slug === slug);
        if (sticker) {
          const scale = instance.getContext().state.scale;
          const { x: canvasX, y: canvasY } = convertToCanvasCoordinates(
            sticker.x + canvasWidth / 2,
            sticker.y + canvasHeight / 2,
            scale
          );
          setTransform(canvasX, canvasY, scale);
          selectSticker(sticker);
        }
      }
    }

    // Handle initial navigation
    handleHashChange();

    // Listen for hash changes
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [stickers, selectSticker]);

  // Update hash when selected sticker changes
  useEffect(() => {
    if (stickers.length === 0) return;
    if (selectedSticker) {
      window.history.pushState(null, "", `#${selectedSticker.slug}`);
    } else {
      window.history.pushState(null, "", window.location.pathname);
    }
  }, [selectedSticker]);
  return null;
}
