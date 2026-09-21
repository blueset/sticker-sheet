import {
  SVGPathData,
  SVGPathDataTransformer,
  type SVGCommand,
} from "svg-pathdata";

export interface SvgPathOption {
  index: number;
  label: string;
}

export interface SvgShapeConversion {
  cssShape: string;
  pathCount: number;
  selectedPath: SvgPathOption;
  viewBox: [number, number, number, number];
}

type MatrixTuple = [number, number, number, number, number, number];

const identityMatrix: MatrixTuple = [1, 0, 0, 1, 0, 0];

function multiplyMatrices(left: MatrixTuple, right: MatrixTuple): MatrixTuple {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function parseNumbers(value: string): number[] {
  return (
    value.match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?/gi)?.map(Number) ?? []
  );
}

function transformFunction(name: string, values: number[]): MatrixTuple {
  switch (name.toLowerCase()) {
    case "matrix":
      if (values.length !== 6) throw new Error("matrix() requires 6 values.");
      return values as MatrixTuple;
    case "translate": {
      if (values.length < 1 || values.length > 2) {
        throw new Error("translate() requires 1 or 2 values.");
      }
      return [1, 0, 0, 1, values[0], values[1] ?? 0];
    }
    case "scale": {
      if (values.length < 1 || values.length > 2) {
        throw new Error("scale() requires 1 or 2 values.");
      }
      return [values[0], 0, 0, values[1] ?? values[0], 0, 0];
    }
    case "rotate": {
      if (values.length !== 1 && values.length !== 3) {
        throw new Error("rotate() requires 1 or 3 values.");
      }
      const radians = (values[0] * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const rotation: MatrixTuple = [cosine, sine, -sine, cosine, 0, 0];
      if (values.length === 1) return rotation;
      const [, centerX, centerY] = values;
      return multiplyMatrices(
        multiplyMatrices([1, 0, 0, 1, centerX, centerY], rotation),
        [1, 0, 0, 1, -centerX, -centerY],
      );
    }
    case "skewx": {
      if (values.length !== 1) throw new Error("skewX() requires 1 value.");
      return [1, 0, Math.tan((values[0] * Math.PI) / 180), 1, 0, 0];
    }
    case "skewy": {
      if (values.length !== 1) throw new Error("skewY() requires 1 value.");
      return [1, Math.tan((values[0] * Math.PI) / 180), 0, 1, 0, 0];
    }
    default:
      throw new Error(`Unsupported SVG transform: ${name}().`);
  }
}

function parseTransform(value: string | null): MatrixTuple {
  if (!value?.trim()) return identityMatrix;

  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix = identityMatrix;
  let consumed = "";
  let match: RegExpExecArray | null;

  while ((match = expression.exec(value))) {
    consumed += match[0];
    matrix = multiplyMatrices(matrix, transformFunction(match[1], parseNumbers(match[2])));
  }

  const normalizedInput = value.replace(/[\s,]+/g, "");
  const normalizedConsumed = consumed.replace(/[\s,]+/g, "");
  if (!consumed || normalizedInput !== normalizedConsumed) {
    throw new Error(`Unable to parse transform: ${value}`);
  }

  return matrix;
}

function getAccumulatedTransform(path: Element, root: Element): MatrixTuple {
  const ancestors: Element[] = [];
  let current: Element | null = path;

  while (current) {
    ancestors.push(current);
    if (current === root) break;
    current = current.parentElement;
  }

  if (ancestors.at(-1) !== root) {
    throw new Error("The selected path is not inside the root SVG element.");
  }

  return ancestors
    .reverse()
    .reduce(
      (matrix, element) =>
        multiplyMatrices(matrix, parseTransform(element.getAttribute("transform"))),
      identityMatrix,
    );
}

function getViewBox(root: Element): [number, number, number, number] {
  const values = parseNumbers(root.getAttribute("viewBox") ?? "");
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) {
    throw new Error("The root SVG must have a valid viewBox with positive dimensions.");
  }
  return values as [number, number, number, number];
}

function getFillRule(path: Element, root: Element): "evenodd" | "nonzero" {
  let current: Element | null = path;

  while (current) {
    const attribute = current.getAttribute("fill-rule");
    const style = current.getAttribute("style");
    const styleMatch = style?.match(/(?:^|;)\s*fill-rule\s*:\s*(evenodd|nonzero)\b/i);
    const value = attribute ?? styleMatch?.[1];
    if (value === "evenodd" || value === "nonzero") return value;
    if (current === root) break;
    current = current.parentElement;
  }

  return "nonzero";
}

function formatNumber(value: number, precision: number): string {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function percent(value: number, precision: number): string {
  return `${formatNumber(value, precision)}%`;
}

function point(x: number, y: number, precision: number): string {
  return `${percent(x, precision)} ${percent(y, precision)}`;
}

function commandToShape(
  command: SVGCommand,
  index: number,
  precision: number,
): string {
  switch (command.type) {
    case SVGPathData.MOVE_TO:
      return `${index === 0 ? "from" : "move to"} ${point(command.x, command.y, precision)}`;
    case SVGPathData.LINE_TO:
      return `line to ${point(command.x, command.y, precision)}`;
    case SVGPathData.CURVE_TO:
      return `curve to ${point(command.x, command.y, precision)} with ${point(command.x1, command.y1, precision)} / ${point(command.x2, command.y2, precision)}`;
    case SVGPathData.QUAD_TO:
      return `curve to ${point(command.x, command.y, precision)} with ${point(command.x1, command.y1, precision)}`;
    case SVGPathData.ARC: {
      const radius = point(command.rX, command.rY, precision);
      const direction = command.sweepFlag ? "cw" : "ccw";
      const size = command.lArcFlag ? " large" : "";
      const rotation = command.xRot
        ? ` rotate ${formatNumber(command.xRot, precision)}deg`
        : "";
      return `arc to ${point(command.x, command.y, precision)} of ${radius} ${direction}${size}${rotation}`;
    }
    case SVGPathData.CLOSE_PATH:
      return "close";
    default:
      throw new Error(`Unsupported normalized path command type: ${command.type}.`);
  }
}

export function listSvgPaths(svgText: string): SvgPathOption[] {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error("The SVG is not valid XML.");

  return Array.from(document.querySelectorAll("path")).map((path, index) => {
    const id = path.getAttribute("id");
    const parentId = path.parentElement?.getAttribute("id");
    const name = id ? `#${id}` : parentId ? `${parentId} path` : "path";
    return { index, label: `${index + 1}. ${name}` };
  });
}

export function svgPathToCssShape(
  svgText: string,
  pathIndex: number,
  precision = 4,
): SvgShapeConversion {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error("The SVG is not valid XML.");

  const root = document.documentElement;
  if (root.localName !== "svg") throw new Error("The document root must be an SVG element.");

  const paths = Array.from(root.querySelectorAll("path"));
  const path = paths[pathIndex];
  if (!path) throw new Error(`Path ${pathIndex + 1} does not exist in this SVG.`);

  const pathData = path.getAttribute("d");
  if (!pathData) throw new Error("The selected path has no path data.");

  const viewBox = getViewBox(root);
  const [minX, minY, width, height] = viewBox;
  const elementMatrix = getAccumulatedTransform(path, root);
  const percentageMatrix: MatrixTuple = [
    100 / width,
    0,
    0,
    100 / height,
    (-minX * 100) / width,
    (-minY * 100) / height,
  ];
  const matrix = multiplyMatrices(percentageMatrix, elementMatrix);

  const parsed = new SVGPathData(pathData)
    .toAbs()
    .normalizeST()
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ(false, true, true, false))
    .transform(SVGPathDataTransformer.MATRIX(...matrix));

  const commands = parsed.commands.map((command, index) =>
    commandToShape(command, index, precision),
  );
  const options = listSvgPaths(svgText);
  const fillRule = getFillRule(path, root);

  return {
    cssShape: `shape(\n  ${fillRule === "evenodd" ? "evenodd " : ""}${commands.join(",\n  ")}\n)`,
    pathCount: paths.length,
    selectedPath: options[pathIndex],
    viewBox,
  };
}