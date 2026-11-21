import React from "react";
import { createPortal } from "react-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

// Opens and closes one tooltip at idle, inside a hidden `aria-hidden` host,
// so the first real open (a tap focuses a zoom button, and Radix opens its
// tooltip on that focus) does not pay for first-time code compilation and
// layout inside the tap's task. Each step is a transition started from its
// own idle callback, and the content mounts before its anchor so the
// positioning code runs in a later step: no step is a long task. Must render
// inside a TooltipProvider.
type Stage = "open" | "anchor" | "close";
const NEXT: Record<Stage, Stage | null> = { open: "anchor", anchor: "close", close: null };
// Longer than the closing animation, so its unmount path runs too.
const CLOSE_MS = 400;

function whenIdle(fn: () => void, delayMs = 0): () => void {
  let idleId: number | undefined;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(fn, { timeout: 2000 });
    } else {
      fn();
    }
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    if (idleId !== undefined) window.cancelIdleCallback(idleId);
  };
}

export function TooltipWarmup({ label, onDone }: { label: string; onDone: () => void }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [stage, setStage] = React.useState<Stage>("open");
  const hostRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => () => hostRef.current?.remove(), []);

  React.useEffect(() => {
    if (!host) {
      return whenIdle(() => {
        const el = document.createElement("div");
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none";
        document.body.append(el);
        hostRef.current = el;
        React.startTransition(() => setHost(el));
      });
    }
    const next = NEXT[stage];
    return whenIdle(
      () => React.startTransition(() => (next ? setStage(next) : onDone())),
      stage === "close" ? CLOSE_MS : 0
    );
  }, [host, stage, onDone]);

  if (!host) return null;
  return createPortal(
    <Tooltip open={stage !== "close"}>
      {stage !== "open" && (
        <TooltipTrigger asChild>
          <span />
        </TooltipTrigger>
      )}
      <TooltipContent container={host}>{label}</TooltipContent>
    </Tooltip>,
    host
  );
}
