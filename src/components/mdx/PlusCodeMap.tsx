import { lazy, Suspense } from "react";
import { useTheme } from "@/lib/theme-hook";
import { MapSkeleton } from "./MapSkeleton";

interface PlusCodeMapProps {
  codes: string[];
}

// Leaflet accesses `window` and `document` at import time, so the inner
// component is only imported once this component renders in the browser.
const PlusCodeMapInner = lazy(() => import("./PlusCodeMapInner"));

export function PlusCodeMap(props: PlusCodeMapProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Suspense fallback={<MapSkeleton />}>
      <PlusCodeMapInner codes={props.codes} theme={resolvedTheme} />
    </Suspense>
  );
}
