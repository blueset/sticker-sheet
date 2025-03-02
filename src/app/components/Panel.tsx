"use client";

import { X } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import "react-spring-bottom-sheet/dist/style.css";
import { useMediaQuery, useThrottledCallback } from "@mantine/hooks";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useCallback, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { MDXRenderer } from "./MDXRenderer";
import { localize } from "../utils/localize";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export const PANEL_HEIGHT = 135;
export const PANEL_WIDTH = 320;
export const PANEL_BREAKPOINT = 4096;
export const PANEL_HEIGHT_SNAPS = [`${PANEL_HEIGHT + 96}px`, 1];
export const PANEL_WIDTH_SNAPS = [1];

export function Panel() {
  const { selectedSticker, language, selectSticker } = useCanvasStore(
    useShallow((s) => ({
      selectedSticker: s.selectedSticker,
      language: s.language,
      selectSticker: s.selectSticker,
    }))
  );
  const isMobile = useMediaQuery(`(max-width: ${PANEL_BREAKPOINT}px)`);
  const { t } = useTranslation();

  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      document.body.style.pointerEvents = "auto";
      panelRef.current?.focus();
    });
  }, [selectedSticker]);

  const snapPoints = isMobile ? PANEL_HEIGHT_SNAPS : PANEL_WIDTH_SNAPS;
  const [activeSnap, setActiveSnap] = useState<string | number | null>(
    snapPoints[0]
  );
  const [mainHasOverflow, setMainHasOverflow] = useState(false);
  const activeSnapRef = useRef<string | number | null>(activeSnap);
  activeSnapRef.current = activeSnap;
  const mainRef = useRef<HTMLDivElement>(null);

  const title = localize(selectedSticker?.title, language);
  const description = localize(selectedSticker?.description, language);
  const content = localize(selectedSticker?.content, language);

  useEffect(() => {
    setActiveSnap(snapPoints[0]);
  }, [snapPoints]);

  const toggleActiveSnap = useCallback(() => {
    if (snapPoints.length === 1) return;
    setActiveSnap((prev) => {
      if (!prev) return prev;
      const index = snapPoints.indexOf(prev);
      return snapPoints[(index + 1) % snapPoints.length];
    });
  }, [setActiveSnap, snapPoints]);

  const handleWheel = useThrottledCallback(
    (
      e: React.WheelEvent<HTMLDivElement>,
      currentTarget: HTMLDivElement,
      deltaY: number
    ) => {
      if (snapPoints.length === 1) return;
      if (activeSnapRef.current === 1) {
        if (currentTarget.scrollTop === 0 && deltaY < 0) {
          e.preventDefault();
          setActiveSnap(snapPoints[0]);
        }
      } else {
        e.preventDefault();
        if (deltaY > 0) {
          setActiveSnap(1);
        } else if (deltaY < 0) {
          selectSticker(null);
        }
      }
    },
    500
  );

  const handleThrottledWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) =>
      handleWheel(e, e.currentTarget, e.deltaY),
    [handleWheel]
  );

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const observer = new ResizeObserver((entries) => {
      setMainHasOverflow(
        entries[0].target.scrollHeight > entries[0].target.clientHeight
      );
    });

    setTimeout(() => {
      setMainHasOverflow(main.scrollHeight > main.clientHeight);
      observer.observe(main);
    }, 500);

    return () => {
      observer.disconnect();
    };
  }, [mainRef.current, selectedSticker?.slug, activeSnap]);

  return (
    <Drawer
      open={!!selectedSticker}
      onOpenChange={(open) => !open && selectSticker(null)}
      modal={false}
      direction={isMobile ? "bottom" : "left"}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
    >
      <DrawerContent
        direction={isMobile ? "bottom" : "left"}
        className="max-w-lg mx-auto"
        style={{
          width: isMobile ? undefined : `${PANEL_WIDTH}px`,
        }}
        ref={panelRef}
      >
        {isMobile && (
          <button
            className="mx-auto my-4 h-2 w-24 rounded-full bg-muted mx-auto block"
            onClick={toggleActiveSnap}
            aria-label={t("togglePanelSize")}
          />
        )}
        <main
          className={cn(
            "h-0 grow",
            activeSnap === 1 && mainHasOverflow && "overflow-y-auto"
          )}
          onWheel={handleThrottledWheel}
          ref={mainRef}
        >
          <DrawerHeader>
            <DrawerTitle className="flex items-center justify-between">
              <span className="grow w-0 text-balance break-auto-phrase select-text">
                {title}
              </span>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="w-8 h-8" />
                </Button>
              </DrawerClose>
            </DrawerTitle>
          </DrawerHeader>
          <div className="m-4">
            <div
              className={cn(
                "transition-all duration-100 mx-auto overflow-hidden drop-shadow-md max-w-full",
                activeSnap === 1 && "my-4"
              )}
              style={{
                height: activeSnap === 1 ? selectedSticker?.height : 0,
                width: selectedSticker?.width ?? 0,
              }}
            >
              {selectedSticker?.image && (
                <img
                  src={selectedSticker.image}
                  alt={title}
                  className="w-full h-full object-contain"
                />
              )}
              {content && (
                <div
                  style={{
                    height: selectedSticker?.height,
                    width: selectedSticker?.width,
                  }}
                >
                  <MDXRenderer source={content} />
                </div>
              )}
            </div>
            {description && (
              <div className="max-w-none select-text">
                <MDXRenderer source={description} />
              </div>
            )}
          </div>
        </main>
      </DrawerContent>
    </Drawer>
  );
}
