// CSS `clip-path` basic shapes to canvas path commands, in px of the sticker
// box (the reference box of `.clip`). `A` is `ctx.ellipse(cx, cy, rx, ry,
// rotation, start, end)`. Anything the prototype does not draw (`shape()`,
// `inset()`, `url()`, malformed input) returns null; that sticker is drawn
// unclipped.
import { SVGPathData } from "svg-pathdata";

export type PathCmd =
  | ["M", number, number]
  | ["L", number, number]
  | ["A", number, number, number, number, number, number, number]
  | ["Z"];

const TAU = 2 * Math.PI;
const FILL_RULE = /^(nonzero|evenodd)\s*,\s*/;
// Flattened curve segments are about this many px long (box units).
const CURVE_STEP_PX = 2;

function length(token: string, basis: number): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|px)?$/i.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "%") return (n * basis) / 100;
  if (m[2] === "px" || n === 0) return n;
  return null;
}

const KEYWORDS: Record<string, { axis: "x" | "y" | "any"; frac: number }> = {
  left: { axis: "x", frac: 0 },
  right: { axis: "x", frac: 1 },
  top: { axis: "y", frac: 0 },
  bottom: { axis: "y", frac: 1 },
  center: { axis: "any", frac: 0.5 },
};

// `at <position>` with one or two values (keywords, lengths, percentages).
function position(tokens: string[], w: number, h: number): [number, number] | null {
  if (tokens.length === 0) return [w / 2, h / 2];
  if (tokens.length > 2) return null;
  let [a, b = "center"] = tokens;
  if (tokens.length === 1 && KEYWORDS[a]?.axis === "y") [a, b] = ["center", a];
  if (KEYWORDS[a]?.axis === "y" || KEYWORDS[b]?.axis === "x") [a, b] = [b, a];
  const x = KEYWORDS[a] && KEYWORDS[a].axis !== "y" ? KEYWORDS[a].frac * w : length(a, w);
  const y = KEYWORDS[b] && KEYWORDS[b].axis !== "x" ? KEYWORDS[b].frac * h : length(b, h);
  return x === null || y === null ? null : [x, y];
}

function radius(token: string, basis: number, near: number, far: number): number | null {
  if (token === "closest-side") return near;
  if (token === "farthest-side") return far;
  const r = length(token, basis);
  return r === null || r < 0 ? null : r;
}

function splitAt(args: string): { size: string[]; at: string[] } | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const i = tokens.indexOf("at");
  if (i === -1) return { size: tokens, at: [] };
  return { size: tokens.slice(0, i), at: tokens.slice(i + 1) };
}

function arc(cx: number, cy: number, rx: number, ry: number): PathCmd[] {
  return [["A", cx, cy, rx, ry, 0, 0, TAU], ["Z"]];
}

function circle(args: string, w: number, h: number): PathCmd[] | null {
  const parts = splitAt(args);
  if (!parts || parts.size.length > 1) return null;
  const c = position(parts.at, w, h);
  if (!c) return null;
  const [cx, cy] = c;
  const near = Math.min(cx, w - cx, cy, h - cy);
  const far = Math.max(cx, w - cx, cy, h - cy);
  const r = radius(parts.size[0] ?? "closest-side", Math.hypot(w, h) / Math.SQRT2, Math.abs(near), Math.abs(far));
  return r === null ? null : arc(cx, cy, r, r);
}

function ellipse(args: string, w: number, h: number): PathCmd[] | null {
  const parts = splitAt(args);
  if (!parts || (parts.size.length !== 0 && parts.size.length !== 2)) return null;
  const c = position(parts.at, w, h);
  if (!c) return null;
  const [cx, cy] = c;
  const [sx = "closest-side", sy = "closest-side"] = parts.size;
  const rx = radius(sx, w, Math.min(cx, w - cx), Math.max(cx, w - cx));
  const ry = radius(sy, h, Math.min(cy, h - cy), Math.max(cy, h - cy));
  return rx === null || ry === null ? null : arc(cx, cy, rx, ry);
}

function polygon(args: string, w: number, h: number): PathCmd[] | null {
  const points = args.replace(FILL_RULE, "").split(",");
  const cmds: PathCmd[] = [];
  for (const point of points) {
    const [a, b, ...rest] = point.trim().split(/\s+/);
    if (b === undefined || rest.length) return null;
    const x = length(a, w);
    const y = length(b, h);
    if (x === null || y === null) return null;
    cmds.push([cmds.length ? "L" : "M", x, y]);
  }
  if (cmds.length < 3) return null;
  cmds.push(["Z"]);
  return cmds;
}

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function path(args: string): PathCmd[] | null {
  const m = /^(['"])(.*)\1$/s.exec(args.replace(FILL_RULE, "").trim());
  if (!m) return null;
  let commands;
  try {
    commands = new SVGPathData(m[2]).toAbs().normalizeHVZ(false).normalizeST().qtToC().aToC().commands;
  } catch {
    return null;
  }
  const cmds: PathCmd[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const c of commands) {
    switch (c.type) {
      case SVGPathData.MOVE_TO:
        cmds.push(["M", c.x, c.y]);
        [x, y] = [sx, sy] = [c.x, c.y];
        break;
      case SVGPathData.LINE_TO:
        cmds.push(["L", c.x, c.y]);
        [x, y] = [c.x, c.y];
        break;
      case SVGPathData.CURVE_TO: {
        const hull = Math.hypot(c.x1 - x, c.y1 - y) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2);
        const n = Math.min(64, Math.max(8, Math.ceil(hull / CURVE_STEP_PX)));
        for (let i = 1; i < n; i++) {
          const t = i / n;
          cmds.push(["L", cubicPoint(t, x, c.x1, c.x2, c.x), cubicPoint(t, y, c.y1, c.y2, c.y)]);
        }
        cmds.push(["L", c.x, c.y]);
        [x, y] = [c.x, c.y];
        break;
      }
      case SVGPathData.CLOSE_PATH:
        cmds.push(["Z"]);
        [x, y] = [sx, sy];
        break;
      default:
        return null;
    }
  }
  return cmds.length ? cmds : null;
}

export function clipToCommands(clip: string, w: number, h: number): PathCmd[] | null {
  const m = /^\s*([a-z-]+)\(([\s\S]*)\)\s*$/i.exec(clip);
  if (!m) return null;
  const [, fn, args] = m;
  switch (fn.toLowerCase()) {
    case "polygon":
      return polygon(args, w, h);
    case "circle":
      return circle(args, w, h);
    case "ellipse":
      return ellipse(args, w, h);
    case "path":
      return path(args);
    default:
      return null;
  }
}
