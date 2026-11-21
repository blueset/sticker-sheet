export type ThemeChoice = "light" | "dark" | "system";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemeChoice(x: unknown): x is ThemeChoice {
  return x === "light" || x === "dark" || x === "system";
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}

function paint(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

let detach: (() => void) | undefined;

export function applyTheme(choice: ThemeChoice): void {
  detach?.();
  detach = undefined;

  const mql = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : undefined;
  paint(resolveTheme(choice, mql?.matches ?? false));

  if (choice !== "system" || !mql) return;
  const onChange = (e: Event) => {
    paint(resolveTheme("system", (e as MediaQueryListEvent).matches ?? mql.matches));
  };
  mql.addEventListener("change", onChange);
  detach = () => mql.removeEventListener("change", onChange);
}
