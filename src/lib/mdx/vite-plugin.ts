import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { parse } from "yaml";
import { LANGS, isLang, type Lang } from "../localize.ts";
import { compileMdx } from "./compile.ts";

const MANIFEST_ID = "virtual:sticker-mdx";
const RESOLVED_MANIFEST = `\0${MANIFEST_ID}`;
const PROVIDER_ID = "#mdx-provider";
const KINDS = ["description", "content"] as const;
type Kind = (typeof KINDS)[number];

const ENTRY_ID = /^virtual:sticker-mdx\/(description|content)\/([^/]+)\/([^/]+)$/;
const SAFE_SLUG = /^[\w-]+$/;

type StickerData = Record<string, unknown>;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function parseEntryId(id: string): { kind: Kind; slug: string; lang: Lang } | undefined {
  const match = ENTRY_ID.exec(id);
  if (!match || !isLang(match[3])) return undefined;
  return { kind: match[1] as Kind, slug: match[2], lang: match[3] };
}

const stickersDir = (root: string) => path.join(root, "src", "data", "stickers");
const stickerFile = (root: string, slug: string) => path.join(stickersDir(root), `${slug}.yaml`);

function listSlugs(root: string): string[] {
  const slugs = fs
    .readdirSync(stickersDir(root))
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -".yaml".length));
  for (const slug of slugs) {
    if (!SAFE_SLUG.test(slug)) {
      throw new Error(`Sticker file name "${slug}.yaml" must use only letters, digits, "_" and "-" so it can name a module.`);
    }
  }
  return slugs.sort(byCodePoint);
}

function readSticker(root: string, slug: string): StickerData {
  const file = stickerFile(root, slug);
  let data: unknown;
  try {
    data = parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read sticker "${slug}" (${file}): ${errorMessage(e)}`, { cause: e });
  }
  if (!isRecord(data)) throw new Error(`Sticker "${slug}" must parse to a YAML mapping.`);
  return data;
}

// The text for one (kind, lang), or undefined when it is missing or empty.
function textOf(data: StickerData, kind: Kind, lang: Lang): string | undefined {
  const field = data[kind];
  const text = isRecord(field) ? field[lang] : undefined;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function manifestCode(root: string): string {
  const stickers = listSlugs(root).map((slug) => ({ slug, data: readSticker(root, slug) }));
  const lines: string[] = [];
  for (const kind of KINDS) {
    lines.push(`export const ${kind} = {`);
    for (const { slug, data } of stickers) {
      const langs = LANGS.filter((lang) => textOf(data, kind, lang) !== undefined);
      if (langs.length === 0) continue;
      lines.push(`  ${JSON.stringify(slug)}: {`);
      for (const lang of langs) {
        // Bundlers split chunks only for literal `import()` specifiers.
        const specifier = JSON.stringify(`${MANIFEST_ID}/${kind}/${slug}/${lang}`);
        lines.push(`    ${JSON.stringify(lang)}: () => import(${specifier}),`);
      }
      lines.push("  },");
    }
    lines.push("};");
  }
  return lines.join("\n");
}

function compileFailure(slug: string, kind: Kind, lang: Lang, cause: unknown): Error {
  return new Error(`Cannot compile the ${kind} MDX of sticker "${slug}" (${lang}): ${errorMessage(cause)}`, { cause });
}

async function entryCode(root: string, slug: string, kind: Kind, lang: Lang): Promise<string> {
  const text = textOf(readSticker(root, slug), kind, lang);
  if (text === undefined) throw new Error(`Sticker "${slug}" has no ${kind} text for ${lang}.`);
  let compiled;
  try {
    compiled = await compileMdx(text);
  } catch (e) {
    throw compileFailure(slug, kind, lang, e);
  }
  return compiled.liveExprs.length > 0
    ? `${compiled.code}\nexport const __liveExprs = ${JSON.stringify(compiled.liveExprs)};\n`
    : compiled.code;
}

export function stickerMdx(): Plugin {
  let root = process.cwd();

  return {
    name: "sticker-mdx",

    configResolved(config) {
      root = config.root;
    },

    configureServer(server) {
      const dir = stickersDir(root);
      const onYamlChange = (file: string) => {
        const relative = path.relative(dir, file);
        if (!relative.endsWith(".yaml") || relative.includes(path.sep) || relative.startsWith("..")) return;
        for (const environment of Object.values(server.environments)) {
          for (const [id, mod] of environment.moduleGraph.idToModuleMap) {
            if (id.startsWith(RESOLVED_MANIFEST)) environment.moduleGraph.invalidateModule(mod);
          }
        }
        server.hot.send({ type: "full-reload" });
      };
      server.watcher.on("add", onYamlChange).on("change", onYamlChange).on("unlink", onYamlChange);
    },

    resolveId(id) {
      if (id === PROVIDER_ID) return path.join(root, "src", "lib", "mdx", "provider.tsx").replaceAll("\\", "/");
      if (id === MANIFEST_ID || parseEntryId(id)) return `\0${id}`;
      return undefined;
    },

    async load(id) {
      if (id === RESOLVED_MANIFEST) return { code: manifestCode(root), map: null };
      const entry = id.startsWith("\0") ? parseEntryId(id.slice(1)) : undefined;
      if (!entry) return undefined;
      this.addWatchFile(stickerFile(root, entry.slug));
      return { code: await entryCode(root, entry.slug, entry.kind, entry.lang), map: null };
    },
  };
}
