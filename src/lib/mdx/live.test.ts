// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LANGS } from "../localize";
import { loadStickers } from "../stickers";
import { compileMdx } from "./compile";
import { assertInteractiveAllowed, prerenderContent, prerenderContentFrom, type LiveKind } from "./prerender";

describe("prerenderContentFrom", () => {
  it("static content has no live nodes", async () => {
    const r = await prerenderContentFrom("<div>hello</div>");
    expect(r.kind).toBe("static");
    expect(r.exprs).toEqual([]);
    expect(r.html).toBe("<div>hello</div>");
  });

  it("date expression is wrapped and extracted", async () => {
    const r = await prerenderContentFrom("<div>{new Date().getFullYear()}</div>");
    expect(r.kind).toBe("date");
    expect(r.exprs).toEqual(["new Date().getFullYear()"]);
    expect(r.html).toContain('data-live="0"');
  });

  it("renders the first mocked date, so builds are deterministic", async () => {
    const r = await prerenderContentFrom("<div>{new Date().getUTCFullYear()}</div>");
    expect(r.html).toBe('<div><span data-live="0">2020</span></div>');
  });

  it("rejects a runtime difference it cannot extract", async () => {
    await expect(
      prerenderContentFrom("export const y = new Date().getFullYear()\n\n<div>{y}</div>"),
    ).rejects.toThrow(/live/i);
  });

  it("names the sticker and language when it cannot extract", async () => {
    await expect(
      prerenderContentFrom("export const y = new Date().getFullYear()\n\n<div>{y}</div>", {
        slug: "year",
        lang: "ja",
      }),
    ).rejects.toThrow(/"year" \(ja\).*live/is);
  });

  it("rejects a date use outside an extracted expression even when another is extracted", async () => {
    await expect(
      prerenderContentFrom(
        "<div title={new Date().getFullYear()}>{new Date().getMonth()}</div>",
      ),
    ).rejects.toThrow(/live/i);
  });

  it("restores the real Date even when rendering throws", async () => {
    const RealDate = Date;
    await expect(prerenderContentFrom("<div>{new Date().foo.bar}</div>")).rejects.toThrow();
    expect(Date).toBe(RealDate);
    expect(new Date().getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("keeps the mocked Date from leaking: explicit arguments behave normally", async () => {
    const r = await prerenderContentFrom("<div>{new Date(2000, 5, 15).getFullYear()}</div>");
    expect(r).toEqual({ html: "<div>2000</div>", kind: "static", exprs: [] });
  });

  it("hooks classify as interactive", async () => {
    expect((await prerenderContent("test-1", "en")).kind).toBe("interactive");
  });

  it("interactive source skips the date check", async () => {
    const r = await prerenderContentFrom(
      "export function C() {\n  const [n] = _provideComponents().React.useState(new Date().getUTCFullYear())\n  return <b>{n}</b>\n}\n\n<C />",
    );
    expect(r.kind).toBe("interactive");
    expect(r.html).toBe("<b>2020</b>");
  });
});

describe("assertInteractiveAllowed", () => {
  it("rejects an interactive sticker that has area", () => {
    expect(() => assertInteractiveAllowed("interactive", 100, 50, { slug: "clock", lang: "en" })).toThrow(
      /Cannot prerender the content of sticker "clock" \(en\): it uses a React hook or timer, which is not hydrated/,
    );
  });

  it("allows a zero-area interactive sticker and non-interactive kinds", async () => {
    expect(() => assertInteractiveAllowed("interactive", 0, 0, { slug: "x", lang: "en" })).not.toThrow();
    expect(() => assertInteractiveAllowed("static", 100, 50, { slug: "x", lang: "en" })).not.toThrow();
    expect((await prerenderContent("test-1", "en")).kind).toBe("interactive");
  });
});

describe("compileMdx markLive", () => {
  const exprsOf = async (source: string) => (await compileMdx(source, { markLive: true })).liveExprs;

  it("does nothing unless asked", async () => {
    const r = await compileMdx("<div>{new Date().getFullYear()}</div>");
    expect(r.liveExprs).toEqual([]);
    expect(r.code).not.toContain("data-live");
  });

  it("numbers expressions in order of appearance, parents and children alike", async () => {
    expect(
      await exprsOf(
        "<div>a {new Date().getFullYear()} b {new Date().getMonth()}<b>{new Date().getDate()}</b>{Math.floor(Date.now() / 1000)}</div>",
      ),
    ).toEqual([
      "new Date().getFullYear()",
      "new Date().getMonth()",
      "new Date().getDate()",
      "Math.floor(Date.now() / 1000)",
    ]);
    expect(await exprsOf("<div><b>{new Date().getMonth()}</b>{new Date().getFullYear()}</div>")).toEqual([
      "new Date().getMonth()",
      "new Date().getFullYear()",
    ]);
  });

  it("collects afresh on every call", async () => {
    const source = "<div>{new Date().getFullYear()}</div>";
    expect(await exprsOf(source)).toEqual(await exprsOf(source));
    expect((await compileMdx(source, { markLive: true })).code).toContain('"data-live": "0"');
  });

  it("leaves expressions without Date alone", async () => {
    const r = await compileMdx("<div>{1 + 1}</div>", { markLive: true });
    expect(r.liveExprs).toEqual([]);
    expect(r.code).not.toContain("data-live");
  });

  it("wraps markdown text expressions", async () => {
    expect(await exprsOf("Year {new Date().getFullYear()}")).toEqual(["new Date().getFullYear()"]);
  });

  it("ignores member names, object keys and bound parameters when checking identifiers", async () => {
    expect(
      await exprsOf(
        "<div>{[1, 2].map((n) => n + Date.now()).join(new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit' }))}</div>",
      ),
    ).toHaveLength(1);
  });

  it("counts shorthand properties as references, but not a member named Date", async () => {
    expect(await exprsOf("<div>{({ Date }).Date.now()}</div>")).toHaveLength(1);
    expect(await exprsOf("<div>{x.Date}</div>")).toEqual([]);
  });

  it("rejects free identifiers outside the allow-list, naming them", async () => {
    await expect(exprsOf("<div>{new Date().getFullYear() + offset}</div>")).rejects.toThrow(/\boffset\b/);
    await expect(exprsOf("<div>{globalThis.x + Date.now()}</div>")).rejects.toThrow(/\bglobalThis\b/);
  });

  it("rejects a date expression that contains JSX", async () => {
    await expect(exprsOf("<div>{new Date().getFullYear() > 2000 && <b>new</b>}</div>")).rejects.toThrow(/JSX/);
  });
});

describe("real stickers", () => {
  const withContent = loadStickers().filter((s) =>
    Object.values(s.content ?? {}).some((text) => text),
  );

  it("classify as expected", async () => {
    const kinds: Record<string, LiveKind> = {};
    for (const { slug } of withContent) kinds[slug] = (await prerenderContent(slug, "en")).kind;
    expect(kinds).toEqual({
      "24h": "static",
      "bad-translations": "static",
      "css-is-awesome": "static",
      "dd-mmm-yyyy": "date",
      "east-asian-spacing": "static",
      "myriad-separator": "static",
      "test-1": "interactive",
      "yyyy-mm-dd": "date",
    });
  });

  it("every language prerenders, with one kind per sticker", async () => {
    for (const { slug, content } of withContent) {
      const kinds = new Set<LiveKind>();
      for (const lang of LANGS) {
        if (!content?.[lang]) continue;
        const r = await prerenderContent(slug, lang);
        expect(r.html.length, `${slug} ${lang}`).toBeGreaterThan(0);
        kinds.add(r.kind);
      }
      expect(kinds.size, slug).toBe(1);
    }
  });

  it("date stickers expose their extracted expressions", async () => {
    const r = await prerenderContent("yyyy-mm-dd", "en");
    expect(r.exprs).toHaveLength(1);
    expect(new Function(`return(${r.exprs[0]})`)()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.html).toContain('data-live="0"');
    for (const slug of ["24h", "myriad-separator"]) {
      const s = await prerenderContent(slug, "en");
      expect(s.exprs).toEqual([]);
      expect(s.html).not.toContain("data-live");
    }
  });

  it("names the sticker and language when there is no content", async () => {
    await expect(prerenderContent("dark", "en")).rejects.toThrow(/"dark".*\ben\b/s);
    await expect(prerenderContent("yyyy-mm-dd", "ja")).rejects.toThrow(/"yyyy-mm-dd".*\bja\b/s);
    await expect(prerenderContent("no-such-sticker", "en")).rejects.toThrow(/"no-such-sticker"/);
  });
});
