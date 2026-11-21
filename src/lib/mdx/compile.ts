import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { recmaLive } from "./recma-live.ts";

export interface CompiledMdx {
  code: string;
  liveExprs: string[];
}

export interface CompileOptions {
  // Wrap date-dependent child expressions in `<span data-live="i">` and report
  // their plain-JS source in `liveExprs`. Only the build-time prerender asks:
  // the client-side Sheet preview must show the live value directly.
  markLive?: boolean;
}

async function compileAs(
  source: string,
  outputFormat: "program" | "function-body",
  { markLive = false }: CompileOptions,
): Promise<CompiledMdx> {
  const liveExprs: string[] = [];
  const file = await compile(source, {
    outputFormat,
    providerImportSource: "#mdx-provider",
    remarkPlugins: [remarkGfm],
    recmaPlugins: markLive ? [[recmaLive, { exprs: liveExprs }]] : [],
    jsxImportSource: "react",
    development: false,
  });
  return { code: String(file), liveExprs };
}

export function compileMdx(source: string, opts: CompileOptions = {}): Promise<CompiledMdx> {
  return compileAs(source, "program", opts);
}

// The same compilation as `compileMdx`, as a function body that `runSync` from
// `@mdx-js/mdx` can execute in Node (the prerender does).
export function compileMdxToFunctionBody(source: string, opts: CompileOptions = {}): Promise<CompiledMdx> {
  return compileAs(source, "function-body", opts);
}
