"use client";

import { ReactZoomPanPinchRef, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { StickerType, useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { Sticker } from "./Sticker";
import { Controls } from "./Controls";
import { FollowCursorTooltip } from "./CursorTooltip";
import { HashNavigator } from "./HashNavigator";
import { convertToCanvasCoordinates } from "../utils/coordinates";
import { useCallback, useEffect, useRef } from "react";
import DebugTools from "./DebugTools";

export function Canvas({
  initialStickers,
}: {
  initialStickers: StickerType[];
}) {
  const {
    stickers,
    canvasWidth,
    canvasHeight,
    selectSticker,
    setPanelOpen,
    setStickers,
  } = useCanvasStore(
    useShallow((s) => ({
      stickers: s.stickers,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      selectSticker: s.selectSticker,
      setPanelOpen: s.setPanelOpen,
      setStickers: s.setStickers,
    }))
  );

  useEffect(() => {
    setStickers(initialStickers); // .filter((s) => !s.content && !(s.image?.endsWith(".svg") ?? false)));
  }, [initialStickers, setStickers]);

  const handleClick = useCallback(
    (sticker: StickerType) => {
      selectSticker(sticker);
      setPanelOpen(true);
    },
    [selectSticker, setPanelOpen]
  );

  const timerRef = useRef<number | null>(null);

  const handleTransformed = useCallback((ref: ReactZoomPanPinchRef) => {
    ref.instance.wrapperComponent?.classList.add("zooming");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      ref.instance.wrapperComponent?.classList.remove("zooming");
    }, 100);
  }, []);

  return (
    <TransformWrapper
      initialScale={1}
      minScale={0.1}
      maxScale={5}
      smooth
      centerOnInit
      onTransformed={handleTransformed}
    >
      {({ zoomIn, zoomOut, setTransform, centerView, instance }) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const handleStickerClick = useCallback(
          (params: { sticker: StickerType; x: number; y: number }) => {
            const scale = instance.getContext().state.scale;
            const { x: canvasX, y: canvasY } = convertToCanvasCoordinates(
              params.x,
              params.y,
              scale
            );
            setTransform(canvasX, canvasY, scale);
            handleClick(params.sticker);
          },
          [setTransform]
        );

        return (
          <>
            <TransformComponent
              wrapperClass="!w-full !h-full"
              wrapperProps={{
                id: "canvasWrapper"
              }}
              // contentClass="relative drop-shadow-md panning:drop-shadow-none zooming:drop-shadow-none" // filter: drop-shadow() has bad perf on mobile (can-hover:drop-shadow-md)
              contentClass="relative bg-grid-png"
              contentStyle={{
                width: canvasWidth,
                height: canvasHeight,
              }}
            >
              {/* {Array.from({ length: canvasWidth / 500 }).flatMap((_, i) =>
                Array.from({ length: canvasHeight / 500 }).map((_, j) => (
                  <div
                    key={`${i}-${j}`}
                    className="text-blue-500 absolute"
                    style={{ top: i * 500, left: j * 500 }}
                  >
                    {i * 500 - canvasWidth / 2}, {j * 500 - canvasHeight / 2}
                  </div>
                ))
              )} */}
              {stickers
              // ?.filter(s => !s.image || s.image.endsWith(".png"))
              // ?.map(s => {
              //   if (s.image?.endsWith(".svg")) {
              //     s.image = s.image.replace(".svg", ".png").replace("stickers/", "stickers/fallback/");
              //   }
              //   return s;
              // })
              ?.map((sticker, idx) => (
                <Sticker
                  key={idx}
                  sticker={sticker}
                  onClick={handleStickerClick}
                />
              ))}
            </TransformComponent>
            <Controls
              zoomIn={zoomIn}
              zoomOut={zoomOut}
              centerView={centerView}
            />
            <FollowCursorTooltip />
            <HashNavigator setTransform={setTransform} instance={instance} />
            {process.env.NODE_ENV === "development" && <DebugTools />}
          </>
        );
      }}
    </TransformWrapper>
  );
}
