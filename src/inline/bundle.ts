import path from "node:path";
import { build } from "esbuild";

// Resolved from the working directory, not `import.meta.url`: Astro runs page
// frontmatter from a temporary build directory.
export async function bundleInline(entry: string): Promise<string> {
  if (!/^[\w-]+$/.test(entry)) throw new Error(`Invalid inline entry: ${entry}`);

  const result = await build({
    entryPoints: [path.resolve(process.cwd(), "src/inline", `${entry}.ts`)],
    bundle: true,
    minify: true,
    format: "iife",
    write: false,
    legalComments: "none",
  });

  const [output] = result.outputFiles;
  if (result.outputFiles.length !== 1 || !output) {
    throw new Error(`Expected one output file for inline entry ${entry}`);
  }
  return output.text;
}
