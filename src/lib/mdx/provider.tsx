import React, { lazy, Suspense, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { MapSkeleton } from "@/components/mdx/MapSkeleton";
import {
  A,
  Abbr,
  Blockquote,
  Code,
  H1,
  H2,
  H3,
  H4,
  Large,
  Lead,
  Muted,
  P,
  Pre,
  Small,
  Ul,
} from "@/components/mdx/Typography";
import { useTheme } from "@/lib/theme-hook";

// Leaflet and the baseline-status web component are heavy and browser-only, so
// each of these three loads on first render. Each wrapper owns its Suspense
// boundary, which keeps authored MDX free of any host-provided boundary.
const LazyPlusCodeMap = lazy(() =>
  import("@/components/mdx/PlusCodeMap").then((m) => ({ default: m.PlusCodeMap })),
);
const LazyCanIUse = lazy(() => import("@/components/mdx/CanIUse"));
const LazyBaselineStatus = lazy(() => import("@/components/mdx/BaselineStatus"));

function PlusCodeMap(props: ComponentProps<typeof LazyPlusCodeMap>) {
  return (
    <Suspense fallback={<MapSkeleton />}>
      <LazyPlusCodeMap {...props} />
    </Suspense>
  );
}

function CanIUse(props: ComponentProps<typeof LazyCanIUse>) {
  return (
    <Suspense fallback={null}>
      <LazyCanIUse {...props} />
    </Suspense>
  );
}

function BaselineStatus(props: ComponentProps<typeof LazyBaselineStatus>) {
  return (
    <Suspense fallback={null}>
      <LazyBaselineStatus {...props} />
    </Suspense>
  );
}

const components: Record<string, unknown> = {
  React,
  Button,
  Link: "a",
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
  p: P,
  blockquote: Blockquote,
  ul: Ul,
  code: Code,
  pre: Pre,
  a: A,
  Abbr,
  Lead,
  Large,
  Muted,
  Small,
  useTheme,
  PlusCodeMap,
  CanIUse,
  BaselineStatus,
};

// MDX calls this as `_provideComponents()` for both its component map and the
// authored `export function`s, so it returns one stable object.
export function useMDXComponents(): Record<string, unknown> {
  return components;
}
