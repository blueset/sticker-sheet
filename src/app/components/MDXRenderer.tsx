"use client";

import React, { useState, useEffect, useMemo, FC } from "react";
import { MDXRemote, MDXRemoteSerializeResult } from "next-mdx-remote";
import { serialize } from "next-mdx-remote/serialize";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import remarkGfm from "remark-gfm";
import {
  H1,
  H2,
  H3,
  H4,
  P,
  Blockquote,
  Ul,
  Code,
  Lead,
  Large,
  Small,
  Muted,
  A,
  Pre,
  Abbr,
} from "./Typography";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

const BaselineStatus = dynamic(
  () =>
    import("baseline-status").then(
      () =>
        function BaselineStatus({ featureId }: { featureId: string }) {
          return <baseline-status featureId={featureId} />;
        }
    ),
  { ssr: false }
);

interface CanIUseProps {
  feature: string;
  past?: string;
  future?: string;
  theme?: string;
  observer?: boolean;
}

function CanIUse({
  feature,
  past,
  future,
  theme,
  observer = false,
}: CanIUseProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const embedRef = React.useRef<HTMLDivElement>(null);
  const [meta] = React.useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const source = useMemo(() => {
    if (!feature) return "";

    const params = [
      ["past", past],
      ["future", future],
      ["theme", theme],
      ["meta", meta],
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    const baseUrl = "https://caniuse-embed.vercel.app";
    return `${baseUrl}/${feature}#${params}`;
  }, [feature, past, future, theme, meta]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data.type === "ciu_embed" && data.payload) {
          const {
            feature: payloadFeature,
            meta: payloadMeta,
            height,
          } = data.payload;
          if (
            payloadFeature === feature &&
            payloadMeta === meta &&
            iframeRef.current
          ) {
            iframeRef.current.style.height = `${Math.ceil(height)}px`;
          }
        }
      } catch {}
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [feature, meta]);

  if (!feature) {
    return (
      <p className="ciu-embed">
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
      className="ciu-embed"
      data-feature={feature}
      data-past={past}
      data-future={future}
      data-theme={theme}
      data-meta={meta}
      data-observer={observer}
    >
      <iframe
        ref={iframeRef}
        className="ciu-embed-iframe"
        src={source}
        style={{
          display: "block",
          width: "100%",
          height: "10px",
          border: "none",
          borderRadius: 0,
        }}
        allow="fullscreen"
      />
    </div>
  );
}

export function MDXRenderer({ source }: { source: string }) {
  const [mdxSource, setMdxSource] = useState<MDXRemoteSerializeResult<Record<string, unknown>, Record<string, unknown>>>();

  useEffect(() => {
    async function prepareMDX() {
      try {
        if (source) {
          const mdxSource = await serialize(source, {
            mdxOptions: {
              useDynamicImport: true,
              remarkPlugins: [remarkGfm],
            },
          });
          setMdxSource(mdxSource);
        }
      } catch (error) {
        console.error(error);
      }
    }
    prepareMDX();
  }, [source]);

  return (
    mdxSource && (
      <MDXRemote
        {...mdxSource}
        components={{
          React,
          Button,
          Link,
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
          BaselineStatus,
          CanIUse,
          useTheme,
        } as unknown as Record<string, FC<unknown>>}
      />
    )
  );
}
