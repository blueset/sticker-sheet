"use client";

import { useRef } from "react";
import { StickerType, useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { MDXRenderer } from "./MDXRenderer";
import { localize } from "../utils/localize";

interface Coords {
  x: number;
  y: number;
}

export function Sticker({
  sticker,
  onClick,
}: {
  sticker: StickerType;
  onClick: (params: Coords & { sticker: StickerType }) => void;
}) {
  const { canvasWidth, canvasHeight, language, setHoveredSticker } =
    useCanvasStore(
      useShallow((s) => ({
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        language: s.language,
        setHoveredSticker: s.setHoveredSticker,
      }))
    );
  const mouseDownCoords = useRef<Coords | null>(null);
  const content = localize(sticker.content, language);
  const title = localize(sticker.title, language);

  return (
    <button
      style={{
        top: sticker.y + (canvasHeight - sticker.height) / 2,
        left: sticker.x + (canvasWidth - sticker.width) / 2,
        width: sticker.width,
        height: sticker.height,
        rotate: (sticker.rotation && `${sticker.rotation}deg`) || undefined,
        contentVisibility: "auto",
        containIntrinsicSize: `${sticker.width}px ${sticker.height}px`,
      }}
      className="z-10 absolute drop-shadow-md can-hover:has-[:hover]:scale-110 transition-transform duration-100 image-rendering-auto"
      onClick={(evt) => {
        if (evt.detail === 0) {
          onClick({
            sticker,
            x: sticker.x + canvasWidth / 2,
            y: sticker.y + canvasHeight / 2,
          });
        }
      }}
    >
      <div
        className="w-full h-full can-hover:hover:cursor-pointer"
        style={{
          clipPath: sticker.clipPath,
        }}
        onMouseDown={(evt) => {
          mouseDownCoords.current = { x: evt.clientX, y: evt.clientY };
        }}
        onClick={(evt) => {
          if (mouseDownCoords.current) {
            const deltaX = evt.clientX - mouseDownCoords.current.x;
            const deltaY = evt.clientY - mouseDownCoords.current.y;
            mouseDownCoords.current = null;
            if (Math.abs(deltaX) >= 10 || Math.abs(deltaY) >= 10) {
              return;
            }
          }
          onClick({
            sticker,
            x: sticker.x + canvasWidth / 2,
            y: sticker.y + canvasHeight / 2,
          });
        }}
        onMouseEnter={() => setHoveredSticker(sticker)}
        onMouseLeave={() => setHoveredSticker(null)}
      >
        {sticker.image && (
          <img
            src={sticker.image}
            alt={title}
            className="w-full h-full object-contain"
          />
        )}
        {content && <MDXRenderer source={content} />}
      </div>
    </button>
  );
}
