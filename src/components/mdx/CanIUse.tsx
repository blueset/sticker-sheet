import React, { useEffect, useMemo } from "react";

const DEFAULT_ORIGIN = "https://caniuse-embed.vercel.app";
let metaCounter = 1;

function parseMessageData(data: unknown): Record<string, unknown> {
  try {
    return typeof data === "string" ? JSON.parse(data) : (data as Record<string, unknown>);
  } catch {
    return {};
  }
}

interface CanIUseProps {
  feature: string;
  past?: string;
  future?: string;
  theme?: string;
  origin?: string;
  baseline?: boolean;
  observer?: boolean;
}

export default function CanIUse({
  feature,
  past,
  future,
  theme,
  origin,
  baseline = false,
  observer = false,
}: CanIUseProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const embedRef = React.useRef<HTMLDivElement>(null);
  const [meta] = React.useState(() => `${Date.now()}-${metaCounter++}`);

  const baseUrl = origin || DEFAULT_ORIGIN;
  const embedClass = baseline ? "ciu-baseline-embed" : "ciu-embed";
  const initialHeight = baseline ? 150 : 350;

  const source = useMemo(() => {
    if (!feature) return "";

    const params = [
      ["past", past],
      ["future", future],
      ["theme", theme],
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    const baselinePath = baseline ? "/baseline" : "";
    return `${baseUrl}/${feature}${baselinePath}#meta=${meta}${params ? `&${params}` : ""}`;
  }, [feature, past, future, theme, meta, baseUrl, baseline]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = parseMessageData(event.data);
      const { type, payload } = data as {
        type?: string;
        payload?: Record<string, unknown>;
      };

      if (type === "ciu-embed" && payload) {
        if (
          payload.feature === feature &&
          payload.meta === meta &&
          iframeRef.current
        ) {
          iframeRef.current.style.height = `${Math.ceil(payload.height as number)}px`;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [feature, meta]);

  if (!feature) {
    return (
      <p className={embedClass}>
        A feature was not included. Go to{" "}
        <a href="https://caniuse.bitsofco.de/#how-to-use">
          https://caniuse.bitsofco.de/#how-to-use
        </a>{" "}
        to generate an embed.
      </p>
    );
  }

  return (
    <div
      ref={embedRef}
      className={embedClass}
      data-feature={feature}
      data-past={past}
      data-future={future}
      data-theme={theme}
      data-meta={meta}
      data-observer={observer}
      data-origin={origin}
    >
      <iframe
        ref={iframeRef}
        className="ciu-embed-iframe"
        src={source}
        style={{
          display: "block",
          width: "100%",
          height: `${initialHeight}px`,
          border: "none",
          borderRadius: 0,
        }}
        allow="fullscreen"
      />
    </div>
  );
}
