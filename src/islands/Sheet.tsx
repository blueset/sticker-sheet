import { Scroll, Sheet as Silk, type ScrollRootProps, type SheetRootProps, type SheetViewProps } from "@silk-hq/components";
import silkCss from "@silk-hq/components/unlayered-styles?url";
import { X } from "lucide-react";
import {
  Component,
  Suspense,
  use,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { select } from "@/lib/appState";
import { PANEL_BREAKPOINT, PANEL_WIDTH, SHEET_PEEK_PX } from "@/lib/geometry";
import { useLanguage, useSelectedSlug } from "@/lib/lang-hook";
import { localize, type Lang } from "@/lib/localize";
import { t } from "@/lib/ui-strings";
import { cn } from "@/lib/utils";

// Silk's stylesheet loads with this chunk, never with the render-blocking page
// CSS. The sheet waits for it so it never flashes unstyled, but a failed or
// stalled stylesheet must not keep it closed: after an error or
// SILK_CSS_TIMEOUT_MS it opens anyway (unstyled, still closable).
const SILK_CSS_TIMEOUT_MS = 3000;
const silkStyles =
  typeof document === "undefined"
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = silkCss;
        link.onload = link.onerror = () => resolve();
        setTimeout(resolve, SILK_CSS_TIMEOUT_MS);
        document.head.append(link);
      });

const NARROW = `(max-width: ${PANEL_BREAKPOINT}px)`;
const subscribeNarrow = (onChange: () => void) => {
  const query = matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches, () => true);

type Mdx = ComponentType<Record<string, never>>;
type Kind = "content" | "description";

// One load per (kind, slug, lang). A failed chunk resolves to null (an empty
// body, nothing logged) and stays cached so a re-render cannot retry in a loop.
const loads = new Map<string, Promise<Mdx | null>>();
function loadMdx(kind: Kind, slug: string, lang: Lang): Promise<Mdx | null> {
  const key = `${kind}\0${slug}\0${lang}`;
  let load = loads.get(key);
  if (!load) {
    load = import("virtual:sticker-mdx")
      .then((m) => {
        const byLang = m[kind][slug];
        const loader = byLang && (byLang[lang] ?? byLang.en ?? Object.values(byLang)[0]);
        return loader ? loader().then((module) => module.default) : null;
      })
      .catch(() => null);
    loads.set(key, load);
  }
  return load;
}

function Mdx({ kind, slug, lang }: { kind: Kind; slug: string; lang: Lang }) {
  const Body = use(loadMdx(kind, slug, lang));
  return Body ? <Body /> : null;
}

// A description that throws while rendering leaves an empty body.
class Contained extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// What the canvas already knows about a sticker: its button's data and image.
function readSticker(slug: string) {
  const el = document.querySelector<HTMLElement>(`button.sticker[data-slug="${CSS.escape(slug)}"]`);
  if (!el) return null;
  return {
    titles: JSON.parse(el.dataset.titles ?? "{}") as Record<string, string>,
    image: el.querySelector("img")?.getAttribute("src") ?? null,
    hasContent: Boolean(el.dataset.has),
    width: parseFloat(el.style.width) || 0,
    height: parseFloat(el.style.height) || 0,
  };
}

export default function Sheet() {
  const selected = useSelectedSlug();
  const lang = useLanguage();
  const bodyLang = useDeferredValue(lang);
  const narrow = useNarrow();

  // Silk keeps the content mounted while it animates out after the selection
  // is already cleared, so the last sticker stays on screen until then.
  const [slug, setSlug] = useState(selected);
  if (selected && selected !== slug) setSlug(selected);
  const sticker = useMemo(() => (slug ? readSticker(slug) : null), [slug]);

  const [styled, setStyled] = useState(false);
  useEffect(() => void silkStyles.then(() => setStyled(true)), []);

  // 0 = closed, 1 = peek, 2 = expanded; Silk owns the steps, the state follows it.
  const [detent, setDetent] = useState(0);

  // Silk re-measures on resize and may step through its stops on the way;
  // restore the stop the reader chose once the viewport settles (peek when the
  // stop set itself changed across the breakpoint).
  const settled = useRef(0);
  const resizing = useRef(0);
  useEffect(() => {
    let wasNarrow = matchMedia(NARROW).matches;
    const onResize = () => {
      cancelAnimationFrame(resizing.current);
      resizing.current = requestAnimationFrame(() => {
        resizing.current = requestAnimationFrame(() => {
          resizing.current = 0;
          const nowNarrow = matchMedia(NARROW).matches;
          if (nowNarrow !== wasNarrow) settled.current = Math.min(settled.current, 1);
          wasNarrow = nowNarrow;
          setDetent(settled.current);
        });
      });
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  const contentRef = useRef<HTMLDivElement>(null);
  // Null until Silk mounts the scroll root (the ref type Silk expects is non-null).
  const scrollRef = useRef<NonNullable<ScrollRootProps["componentRef"]>["current"]>(null!);
  const viewRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ distance: 0, animationSettings: { skip: true } });
    const frame = requestAnimationFrame(() => contentRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [slug]);

  // At the expanded stop, travelling away dismisses the on-screen keyboard.
  const onTravel = useMemo<SheetViewProps["onTravel"]>(
    () =>
      detent === 2
        ? ({ progress }) => {
            if (progress < 0.999) viewRef.current?.focus();
          }
        : undefined,
    [detent],
  );

  const title = sticker ? localize(sticker.titles, lang) : undefined;

  return (
    <Silk.Root
      {...({} as unknown as SheetRootProps)}
      presented={styled && selected !== null}
      onPresentedChange={(open) => !open && select(null, { push: true })}
      activeDetent={detent}
      onActiveDetentChange={(d) => {
        if (!resizing.current) settled.current = d;
        setDetent(d);
      }}
    >
      <Silk.Portal>
        <Silk.View
          ref={viewRef}
          contentPlacement={narrow ? "bottom" : "left"}
          detents={narrow ? `${SHEET_PEEK_PX}px` : `${PANEL_WIDTH}px`}
          swipeOvershoot={false}
          nativeEdgeSwipePrevention
          inertOutside={false}
          onClickOutside={{ dismiss: false, stopOverlayPropagation: false }}
          onTravel={onTravel}
        >
          <Silk.Content
            id="sheet"
            ref={contentRef}
            className="flex flex-col bg-background/75 dark:bg-background/85 backdrop-blur-md mx-auto border rounded-t-[10px] max-w-lg h-[calc(100dvh_-_3em)]"
          >
            {narrow && (
              <Silk.Trigger asChild action="step">
                <button className="block bg-muted mx-auto my-4 rounded-full w-24 h-2" aria-label={t(lang, "togglePanelSize")} />
              </Silk.Trigger>
            )}
            <Scroll.Root asChild componentRef={scrollRef}>
              <Scroll.View
                scrollGestureTrap={{ yEnd: true }}
                scrollGesture={detent === 2 ? "auto" : false}
                safeArea="layout-viewport"
                className="flex-1"
                onScrollStart={{ dismissKeyboard: true }}
              >
                <Scroll.Content>
                  <main className="h-0 grow">
                    <div className="gap-1.5 grid mx-4 text-left">
                      <Silk.Title className="flex justify-between items-center">
                        <span className="w-0 break-auto-phrase text-balance select-text grow">{title}</span>
                        <Silk.Trigger asChild action="dismiss">
                          <Button variant="ghost" size="icon" aria-label={t(lang, "close")} className="-mr-2">
                            <X className="w-8 h-8" />
                          </Button>
                        </Silk.Trigger>
                      </Silk.Title>
                    </div>
                    {slug && sticker && (
                      <div className="m-4">
                        <div
                          className={cn(
                            "drop-shadow-md mx-auto max-w-full overflow-hidden transition-all duration-100",
                            detent === 2 && "my-4",
                          )}
                          style={{ height: detent === 2 ? sticker.height : 0, width: sticker.width }}
                        >
                          {sticker.image && <img src={sticker.image} alt={title} className="w-full h-full object-contain" />}
                          {sticker.hasContent && (
                            <div style={{ height: sticker.height, width: sticker.width }}>
                              <Suspense key={slug} fallback={null}>
                                <Contained key={`${slug}:${bodyLang}`} fallback={null}>
                                  <Mdx kind="content" slug={slug} lang={bodyLang} />
                                </Contained>
                              </Suspense>
                            </div>
                          )}
                        </div>
                        {/* Suspense keyed by sticker only: a deferred language
                            switch keeps the old body until the new one is ready. */}
                        <Suspense key={slug} fallback={<div id="sheet-description" aria-busy="true" />}>
                          <Contained key={`${slug}:${bodyLang}`} fallback={<div id="sheet-description" aria-busy="false" />}>
                            <div id="sheet-description" aria-busy="false" className="max-w-none select-text">
                              <Mdx kind="description" slug={slug} lang={bodyLang} />
                            </div>
                          </Contained>
                        </Suspense>
                      </div>
                    )}
                  </main>
                </Scroll.Content>
              </Scroll.View>
            </Scroll.Root>
          </Silk.Content>
        </Silk.View>
      </Silk.Portal>
    </Silk.Root>
  );
}
