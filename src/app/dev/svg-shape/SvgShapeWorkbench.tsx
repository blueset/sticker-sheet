"use client";

import { Button } from "@/components/ui/button";
import {
  listSvgPaths,
  svgPathToCssShape,
  type SvgPathOption,
} from "@/lib/svgToCssShape";
import { ArrowLeft, Check, Copy, FileUp, Minimize2, WandSparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";

const fieldClassName =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

function compactShape(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s+/g, ",");
}

export default function SvgShapeWorkbench() {
  const [svgText, setSvgText] = useState("");
  const [paths, setPaths] = useState<SvgPathOption[]>([]);
  const [pathIndex, setPathIndex] = useState(0);
  const [precision, setPrecision] = useState(4);
  const [cssShape, setCssShape] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"formatted" | "compact" | null>(null);

  useEffect(() => {
    fetch("/stickers/pedantic.svg")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the example SVG.");
        return response.text();
      })
      .then((text) => {
        setSvgText(text);
        setPaths(listSvgPaths(text));
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load the example SVG.");
      });
  }, []);

  function inspectSvg(text: string) {
    setSvgText(text);
    setCssShape("");
    setCopied(null);
    try {
      const nextPaths = listSvgPaths(text);
      setPaths(nextPaths);
      setPathIndex(0);
      setError(nextPaths.length ? "" : "This SVG does not contain any paths.");
    } catch (reason) {
      setPaths([]);
      setError(reason instanceof Error ? reason.message : "Could not parse the SVG.");
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then(inspectSvg).catch(() => setError("Could not read the SVG file."));
    event.target.value = "";
  }

  function convert() {
    try {
      const result = svgPathToCssShape(svgText, pathIndex, precision);
      setCssShape(result.cssShape);
      setError("");
      setCopied(null);
    } catch (reason) {
      setCssShape("");
      setError(reason instanceof Error ? reason.message : "Conversion failed.");
    }
  }

  async function copyOutput(format: "formatted" | "compact") {
    await navigator.clipboard.writeText(
      format === "compact" ? compactShape(cssShape) : cssShape,
    );
    setCopied(format);
  }

  const sourceUrl = svgText
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
    : "";

  return (
    <main className="bg-[radial-gradient(circle_at_top_left,hsl(var(--muted))_0,transparent_42%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--accent)))] p-4 sm:p-8 h-dvh overflow-y-auto">
      <div className="flex flex-col gap-6 mx-auto max-w-7xl">
        <header className="flex flex-wrap justify-between items-start gap-4 pb-5 border-b">
          <div>
            <div className="flex items-center gap-2 mb-3 font-semibold text-muted-foreground text-xs uppercase">
              Development tool
              <span className="bg-border w-8 h-px" />
              SVG geometry
            </div>
            <h1 className="font-mono font-semibold text-2xl sm:text-3xl">
              SVG path → CSS shape()
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
              Select one path, flatten its ancestor transforms, and normalize it to
              the root viewBox as percentages.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft />
              Canvas
            </Link>
          </Button>
        </header>

        <section className="gap-6 grid lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <label htmlFor="svg-source" className="font-semibold text-sm">
                SVG source
              </label>
              <Button asChild variant="outline" size="sm">
                <label className="cursor-pointer">
                  <FileUp />
                  Open SVG
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/svg+xml,.svg"
                    onChange={handleFile}
                  />
                </label>
              </Button>
            </div>
            <textarea
              id="svg-source"
              className={`${fieldClassName} min-h-72 resize-y font-mono text-xs leading-5 lg:min-h-[32rem]`}
              spellCheck={false}
              value={svgText}
              onChange={(event) => inspectSvg(event.target.value)}
              placeholder="Paste a complete SVG document…"
            />
          </div>

          <aside className="flex flex-col gap-5 pt-5 lg:pt-0 lg:pl-6 border-t lg:border-t-0 lg:border-l">
            <div className="gap-3 grid grid-cols-[1fr_6rem]">
              <label className="font-semibold text-sm">
                Path
                <select
                  className={`${fieldClassName} mt-2 font-normal`}
                  value={pathIndex}
                  onChange={(event) => setPathIndex(Number(event.target.value))}
                  disabled={!paths.length}
                >
                  {paths.map((path) => (
                    <option key={path.index} value={path.index}>
                      {path.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-semibold text-sm">
                Precision
                <input
                  className={`${fieldClassName} mt-2 font-normal`}
                  type="number"
                  min={0}
                  max={8}
                  value={precision}
                  onChange={(event) =>
                    setPrecision(Math.max(0, Math.min(8, Number(event.target.value))))
                  }
                />
              </label>
            </div>

            <Button onClick={convert} disabled={!paths.length}>
              <WandSparkles />
              Convert selected path
            </Button>

            {error && (
              <p role="alert" className="pl-3 border-destructive border-l-2 text-destructive text-sm">
                {error}
              </p>
            )}

            <div className="gap-3 grid grid-cols-2">
              <figure>
                <figcaption className="mb-2 font-semibold text-muted-foreground text-xs">
                  Source SVG
                </figcaption>
                <div className="flex justify-center items-center bg-[length:16px_16px] bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] p-3 border aspect-[4/3] overflow-hidden">
                  {sourceUrl && (
                    <Image
                      className="max-w-full max-h-full object-contain"
                      src={sourceUrl}
                      alt="Uploaded SVG preview"
                      width={976}
                      height={249}
                      unoptimized
                    />
                  )}
                </div>
              </figure>
              <figure>
                <figcaption className="mb-2 font-semibold text-muted-foreground text-xs">
                  CSS shape
                </figcaption>
                <div className="bg-muted border aspect-[4/3] overflow-hidden">
                  <div
                    className="bg-[linear-gradient(135deg,#00a896,#f4d35e_55%,#ee6055)] w-full h-full"
                    style={{ clipPath: cssShape || "none" }}
                  />
                </div>
              </figure>
            </div>
          </aside>
        </section>

        <section className="flex flex-col gap-3 pt-5 border-t">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <label htmlFor="css-output" className="font-semibold text-sm">
              CSS output
            </label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyOutput("formatted")}
                disabled={!cssShape}
              >
                {copied === "formatted" ? <Check /> : <Copy />}
                {copied === "formatted" ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyOutput("compact")}
                disabled={!cssShape}
              >
                {copied === "compact" ? <Check /> : <Minimize2 />}
                {copied === "compact" ? "Copied compact" : "Copy compact"}
              </Button>
            </div>
          </div>
          <textarea
            id="css-output"
            className={`${fieldClassName} min-h-64 resize-y font-mono text-xs leading-5`}
            readOnly
            value={cssShape}
            placeholder="The generated shape() value will appear here."
          />
        </section>
      </div>
    </main>
  );
}