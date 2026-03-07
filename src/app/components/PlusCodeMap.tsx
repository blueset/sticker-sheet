"use client";

import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

interface PlusCodeMapProps {
  codes: string[];
}

interface PlusCodeMapInnerProps {
  codes: string[];
  theme: string;
}

// Leaflet accesses `window` and `document` at import time, which crashes
// during Next.js server-side rendering (even in "use client" components,
// since those are still SSR'd to produce the initial HTML).
// `dynamic` with `ssr: false` ensures the inner component is only ever
// imported and rendered in the browser.
const PlusCodeMapInner = dynamic<PlusCodeMapInnerProps>(
  () => import("./PlusCodeMapInner") as Promise<{ default: ComponentType<PlusCodeMapInnerProps> }>,
  {
    ssr: false,
    loading: () => (
      <div
        style={{ width: "100%", height: "400px" }}
        className="bg-muted rounded-md animate-pulse"
      />
    ),
  }
);

export function PlusCodeMap(props: PlusCodeMapProps) {
  const { resolvedTheme } = useTheme();
  return (
    <PlusCodeMapInner codes={props.codes} theme={resolvedTheme ?? "light"} />
  );
}