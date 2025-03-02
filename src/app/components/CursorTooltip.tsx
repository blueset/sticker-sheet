"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEffect, useRef, useState } from "react";
import { StickerType, useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { localize } from "../utils/localize";
import { useMediaQuery } from "@mantine/hooks";

function FollowCursorTooltipContent({
  title,
  hoveredStickerRef,
}: {
  title?: string;
  hoveredStickerRef: React.RefObject<StickerType | null>;
}) {
  const [{ clientX, clientY }, setPosition] = useState({
    clientX: 0,
    clientY: 0,
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (hoveredStickerRef.current) {
        setPosition({ clientX: event.clientX, clientY: event.clientY });
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <TooltipContent
      side="top"
      align="start"
      alignOffset={clientX}
      sideOffset={-clientY + 10}
    >
      {title}
    </TooltipContent>
  );
}

export function FollowCursorTooltip() {
  const { hoveredSticker, language } = useCanvasStore(
    useShallow((s) => ({
      hoveredSticker: s.hoveredSticker,
      language: s.language,
    }))
  );

  const hoveredStickerRef = useRef<StickerType | null>(null);
  hoveredStickerRef.current = hoveredSticker;
  const title = localize(hoveredSticker?.title, language);
  const isTouch = useMediaQuery("(pointer: coarse)");

  return (
    <Tooltip open={!!hoveredSticker && !isTouch}>
      <TooltipTrigger asChild={true}>
        <div className="fixed inset-0 pointer-events-none w-screen h-screen" />
      </TooltipTrigger>
      <FollowCursorTooltipContent
        title={title}
        hoveredStickerRef={hoveredStickerRef}
      />
    </Tooltip>
  );
}
