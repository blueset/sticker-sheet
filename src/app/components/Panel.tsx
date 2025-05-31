"use client";

import { X } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { useMediaQuery } from "@mantine/hooks";
import {
  Scroll,
  Sheet,
  SheetRootProps,
  SheetViewProps,
} from "@silk-hq/components";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { MDXRenderer } from "./MDXRenderer";
import { localize } from "../utils/localize";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export const PANEL_HEIGHT = 135;
export const PANEL_WIDTH = 320;
export const PANEL_BREAKPOINT = 4096;
export const PANEL_HEIGHT_SNAPS = [
  `${PANEL_HEIGHT + 96}px`,
  "calc(100vh - 96px)",
];
export const PANEL_WIDTH_SNAPS = [`${PANEL_WIDTH}px`];

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

  const snapPoints = isMobile ? PANEL_HEIGHT_SNAPS[0] : PANEL_WIDTH_SNAPS[0];
  const [activeSnap, setActiveSnap] = useState<number>(0);
  const activeSnapRef = useRef<string | number | null>(activeSnap);
  activeSnapRef.current = activeSnap;
  const mainRef = useRef<HTMLDivElement>(null);

  const title = localize(selectedSticker?.title, language);
  const description = localize(selectedSticker?.description, language);
  const content = localize(selectedSticker?.content, language);

  useEffect(() => {
    setActiveSnap(0);
  }, [snapPoints]);

  const toggleActiveSnap = useCallback(() => {
    if (snapPoints.length === 1) return;
    setActiveSnap((prev) => {
      if (!prev) return prev;
      return (prev + 1) % snapPoints.length;
    });
  }, [snapPoints.length]);

  const viewRef = useRef<HTMLElement>(null);
  const travelHandler = useMemo(() => {
    if (activeSnap !== 2) return undefined;

    const handler: SheetViewProps["onTravel"] = ({ progress }) => {
      if (!viewRef.current) return;

      // Dismiss the on-screen keyboard.
      if (progress < 0.999) {
        viewRef.current.focus();
      }
    };
    return handler;
  }, [activeSnap]);

  return (
    <Sheet.Root
      {...({} as unknown as SheetRootProps)}
      presented={!!selectedSticker}
      onPresentedChange={(open) => !open && selectSticker(null)}
      activeDetent={activeSnap}
      onActiveDetentChange={setActiveSnap}
    >
      <Sheet.Portal>
        <Sheet.View
          contentPlacement={isMobile ? "bottom" : "left"}
          detents={snapPoints}
          swipeOvershoot={false}
          nativeEdgeSwipePrevention={true}
          inertOutside={false}
          onClickOutside={{
            dismiss: false,
            stopOverlayPropagation: false,
          }}
          onTravel={travelHandler}
          ref={viewRef}
        >
          <Sheet.Content
            className="flex flex-col bg-background/75 dark:bg-background/85 backdrop-blur-md mx-auto border rounded-t-[10px] max-w-lg h-[calc(100dvh_-_3em)]"
            ref={panelRef}
          >
            {isMobile && (
              <button
                className="block bg-muted mx-auto my-4 rounded-full w-24 h-2"
                onClick={toggleActiveSnap}
                aria-label={t("togglePanelSize")}
              />
            )}
            <Scroll.Root asChild>
              <Scroll.View
                scrollGestureTrap={{ yEnd: true }}
                scrollGesture={activeSnap !== 2 ? false : "auto"}
                safeArea="layout-viewport"
                className="flex-1"
                onScrollStart={{
                  dismissKeyboard: true,
                }}
              >
                <Scroll.Content>
                  <main
                    className={cn(
                      "h-0 grow"
                      // activeSnap === 1 && mainHasOverflow && "overflow-y-auto"
                    )}
                    // onWheel={handleThrottledWheel}
                    ref={mainRef}
                  >
                    <div className="gap-1.5 grid mx-4 text-left">
                      <Sheet.Title className="flex justify-between items-center">
                        <span className="w-0 break-auto-phrase text-balance select-text grow">
                          {title}
                        </span>
                        <Sheet.Trigger asChild action="dismiss">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Close"
                            className="-mr-4"
                          >
                            <X className="w-8 h-8" />
                          </Button>
                        </Sheet.Trigger>
                      </Sheet.Title>
                    </div>
                    <div className="m-4">
                      <div
                        className={cn(
                          "drop-shadow-md mx-auto max-w-full overflow-hidden transition-all duration-100",
                          activeSnap === 2 && "my-4"
                        )}
                        style={{
                          height:
                            activeSnap === 2
                              ? selectedSticker?.height
                              : 0,
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
                </Scroll.Content>
              </Scroll.View>
            </Scroll.Root>
          </Sheet.Content>
        </Sheet.View>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
