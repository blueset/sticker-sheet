import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";

export interface CompiledMdx {
  code: string;
  liveExprs: string[];
}

// `markLive` is accepted now so callers have their final signature; marking
// live expressions arrives in a later task, so `liveExprs` is always empty.
export async function compileMdx(
  source: string,
  _opts?: { markLive?: boolean },
): Promise<CompiledMdx> {
  const file = await compile(source, {
    outputFormat: "program",
    providerImportSource: "#mdx-provider",
    remarkPlugins: [remarkGfm],
    jsxImportSource: "react",
    development: false,
  });
  return { code: String(file), liveExprs: [] };
}
