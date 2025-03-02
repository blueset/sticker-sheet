/* eslint-disable react-hooks/rules-of-hooks */
"use client";

import { Point2d } from "@tweakpane/core/dist/input-binding/point-2d/model/point-2d";
import { useEffect, useRef } from "react";
import { Pane } from "tweakpane";
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';
import { useShallow } from "zustand/react/shallow";
import { StickerType, useCanvasStore } from "../store/useCanvasStore";
import { BindingApi } from "@tweakpane/core/dist/blade/binding/api/binding";

export default function DebugTools() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  const { stickers, selectedSticker, updateSticker } = useCanvasStore(
    useShallow((s) => ({
      stickers: s.stickers,
      selectedSticker: s.selectedSticker,
      updateSticker: s.updateSticker,
    }))
  );

  const stickersRef = useRef<StickerType[]>(stickers);
  stickersRef.current = stickers;
  const indexBindingRef = useRef<BindingApi<unknown, number> | null>(null);

  useEffect(() => {
    if (!stickers.length) return;

    const pane = new Pane({
      title: "Canvas",
    });
    pane.registerPlugin(EssentialsPlugin);
    const s = stickers[0] ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
    };
    const params = {
      index: 0,
      coords: { x: s.x, y: s.y },
      width: s.width,
      height: s.height,
      rotation: s.rotation ?? 0,
    };
    const indexBinding = pane.addBinding(params, "index", {
      options: Object.fromEntries(stickers.map((s, idx) => [s.title.en, idx])),
    });
    const rotationBinding = pane.addBinding(params, "rotation", {
      min: -360,
      max: 360,
      step: 5,
    });
    indexBindingRef.current = indexBinding;
    const coordsBinding = pane.addBinding(params, "coords", {
      x: { min: -1000, max: 1000, step: 5 },
      y: { min: -1000, max: 1000, step: 5 },
    });
    const widthBinding = pane.addBinding(params, "width");
    const heightBinding = pane.addBinding(params, "height");
    const fpsBlade = pane.addBlade({
      view: "fpsgraph",
      label: "FPS",
      rows: 2,
    }) as unknown as EssentialsPlugin.FpsGraphController;
    function render() {
      fpsBlade.begin();
      fpsBlade.end();
      requestAnimationFrame(render);
    }
    render();
    indexBinding.on("change", (ev) => {
      const sticker = stickersRef.current[ev.value];
      coordsBinding.controller.value.setRawValue(
        new Point2d(sticker.x, sticker.y)
      );
      widthBinding.controller.value.setRawValue(sticker.width);
      heightBinding.controller.value.setRawValue(sticker.height);
      rotationBinding.controller.value.setRawValue(sticker.rotation ?? 0);
    });
    const coordsButton = coordsBinding.element.querySelector("button");
    coordsButton?.addEventListener("keydown", (ev) => {
      console.log("button keydown", ev.key, document.activeElement);
      if (document.activeElement !== coordsButton) return;
      const rawValue = coordsBinding.controller.value.rawValue as Point2d;
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        coordsBinding.controller.value.setRawValue(new Point2d(
          rawValue.x,
          rawValue.y - 5,
        ));
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        coordsBinding.controller.value.setRawValue(new Point2d(
          rawValue.x,
          rawValue.y + 5,
        ));
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        coordsBinding.controller.value.setRawValue(new Point2d(
          rawValue.x - 5,
          rawValue.y,
        ));
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        coordsBinding.controller.value.setRawValue(new Point2d(
          rawValue.x + 5,
          rawValue.y,
        ));
      }
    });
    coordsBinding.on("change", (ev) => {
      updateSticker(indexBinding.controller.value.rawValue as number, {
        x: ev.value.x,
        y: ev.value.y,
      });
    });
    widthBinding.on("change", (ev) => {
      updateSticker(indexBinding.controller.value.rawValue as number, {
        width: ev.value,
      });
    });
    heightBinding.on("change", (ev) => {
      updateSticker(indexBinding.controller.value.rawValue as number, {
        height: ev.value,
      });
    });
    rotationBinding.on("change", (ev) => {
      updateSticker(indexBinding.controller.value.rawValue as number, {
        rotation: ev.value,
      });
    });
  }, [stickers.length]);

  useEffect(() => {
    const stickerIndex = stickers.findIndex((s) => s === selectedSticker);
    if (indexBindingRef.current && stickerIndex !== -1) {
      indexBindingRef.current.controller.value.setRawValue(stickerIndex);
    }
  }, [selectedSticker]);
  return null;
}
