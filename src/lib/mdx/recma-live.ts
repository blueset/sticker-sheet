import type { CallExpression, Expression, Literal, Node, Program, Property } from "estree";
import { createVisitors } from "estree-util-scope";
import { toJs } from "estree-util-to-js";
import { walk } from "estree-walker";

// What an extracted expression may name: it is re-evaluated in the browser by
// `new Function`, where nothing else from the MDX module exists.
export const LIVE_GLOBALS: ReadonlySet<string> = new Set([
  "Date",
  "Intl",
  "Math",
  "Number",
  "String",
  "Array",
  "Object",
]);

export interface LiveOptions {
  // Receives the plain-JS source of each wrapped expression, in order.
  exprs: string[];
}

const isJsxCall = (node: Node): node is CallExpression & { callee: { name: string } } =>
  node.type === "CallExpression" &&
  node.callee.type === "Identifier" &&
  (node.callee.name === "_jsx" || node.callee.name === "_jsxs");

const JSX_NAMES = new Set(["_jsx", "_jsxs", "_Fragment", "_components"]);

// Whether an identifier node is a use of a variable rather than a name that
// merely sits in an identifier position (`a.b`, `{ b: 1 }`, `label:`).
function isReference(parent: Node | null, key: string | number | symbol | null | undefined): boolean {
  switch (parent?.type) {
    case "MemberExpression":
    case "Property":
    case "PropertyDefinition":
    case "MethodDefinition":
      return key !== (parent.type === "MemberExpression" ? "property" : "key") || parent.computed;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return key !== "label";
    case "MetaProperty":
      return false;
    default:
      return true;
  }
}

function freeIdentifiers(root: Node): Set<string> {
  const scope = createVisitors();
  const free = new Set<string>();
  walk(root, {
    enter(node, parent, key) {
      scope.enter(node);
      if (
        node.type === "Identifier" &&
        isReference(parent, key) &&
        !scope.scopes.some((s) => s.defined.includes(node.name))
      ) {
        free.add(node.name);
      }
    },
    leave: scope.exit,
  });
  return free;
}

function sourceOf(expression: Expression): string {
  const program: Program = {
    type: "Program",
    sourceType: "module",
    body: [{ type: "ExpressionStatement", expression }],
  };
  return toJs(program).value.trim().replace(/;$/, "");
}

const literal = (value: string): Literal => ({ type: "Literal", value });

const property = (key: string, value: Expression): Property => ({
  type: "Property",
  kind: "init",
  method: false,
  shorthand: false,
  computed: false,
  key: literal(key),
  value,
});

// The child expressions of a compiled element: `_jsx(tag, { children: x })`
// has one, `_jsxs(tag, { children: [a, b] })` has several.
function childrenOf(call: CallExpression & { callee: { name: string } }): Expression[] {
  const props = call.arguments[1];
  if (props?.type !== "ObjectExpression") return [];
  const children = props.properties.find(
    (p): p is Property =>
      p.type === "Property" &&
      !p.computed &&
      ((p.key.type === "Identifier" && p.key.name === "children") ||
        (p.key.type === "Literal" && p.key.value === "children")),
  );
  const value = children?.value as Expression | undefined;
  if (!value) return [];
  if (call.callee.name === "_jsxs" && value.type === "ArrayExpression") {
    return value.elements.filter((e): e is Expression => e !== null && e.type !== "SpreadElement");
  }
  return [value];
}

function liveError(source: string, names: string[]): Error {
  const hint = names.some((name) => JSX_NAMES.has(name))
    ? "it contains JSX"
    : `it uses ${names.map((name) => `"${name}"`).join(", ")}`;
  return new Error(
    `Cannot make this date-dependent expression live: ${hint}, but a live expression may only use ` +
      `${[...LIVE_GLOBALS].join(", ")}, because the browser evaluates it on its own. Expression: ${source}`,
  );
}

// A recma plugin (it runs after MDX has compiled JSX away, so elements are
// `_jsx`/`_jsxs` calls). It wraps each child expression that uses `Date` in
// `<span data-live="i">`, numbered in order of appearance, and records the
// expression's source in `exprs[i]` for the page to emit.
export function recmaLive({ exprs }: LiveOptions) {
  return function (tree: Program): undefined {
    // Child expression -> the `_jsx`/`_jsxs` identifier of the element holding it.
    const childOf = new Map<Node, string>();

    walk(tree, {
      enter(node) {
        const callee = childOf.get(node);
        if (callee !== undefined && node.type !== "Literal" && !isJsxCall(node)) {
          const free = freeIdentifiers(node);
          if (free.has("Date")) {
            const source = sourceOf(node as Expression);
            const extra = [...free].filter((name) => !LIVE_GLOBALS.has(name));
            if (extra.length > 0) throw liveError(source, extra);
            const index = exprs.push(source) - 1;
            const child = node as Expression;
            this.replace({
              type: "CallExpression",
              optional: false,
              callee: { type: "Identifier", name: callee },
              arguments: [
                literal("span"),
                {
                  type: "ObjectExpression",
                  properties: [
                    property("data-live", literal(String(index))),
                    property("children", callee === "_jsxs" ? { type: "ArrayExpression", elements: [child] } : child),
                  ],
                },
              ],
            });
            this.skip();
            return;
          }
        }
        if (isJsxCall(node)) {
          for (const child of childrenOf(node)) childOf.set(child, node.callee.name);
        }
      },
    });
  };
}
