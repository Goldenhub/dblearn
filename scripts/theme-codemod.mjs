/** Accent-color theming codemod (plain JS).
 *
 * The zinc scale is handled by the CSS-variable remap in globals.css.
 * Accents (emerald/sky/amber/rose/red/violet/cyan/orange) keep their
 * visual semantics in both themes, so bright *text* shades and deep
 * tint-*panel* shades need an explicit `dark:` variant.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

const ROOT = process.cwd() + "/src/components";

// long tokens first so a prefix replacement cannot corrupt a longer one
const MAP = Object.freeze([
  // ---- bright text shades (need a darker light variant) ----
  ["text-emerald-300/90", "text-emerald-700/90 dark:text-emerald-300/90"],
  ["text-emerald-400/80", "text-emerald-600/80 dark:text-emerald-400/80"],
  ["text-emerald-200/90", "text-emerald-800/90 dark:text-emerald-200/90"],
  ["text-emerald-200/80", "text-emerald-800/80 dark:text-emerald-200/80"],
  ["text-emerald-400",   "text-emerald-600 dark:text-emerald-400"],
  ["text-emerald-300",   "text-emerald-700 dark:text-emerald-300"],
  ["text-emerald-200",   "text-emerald-800 dark:text-emerald-200"],
  ["text-emerald-500",   "text-emerald-700 dark:text-emerald-500"],

  ["text-amber-400/90",  "text-amber-600/90 dark:text-amber-400/90"],
  ["text-amber-300/90",  "text-amber-700/90 dark:text-amber-300/90"],
  ["text-amber-200/90",  "text-amber-800/90 dark:text-amber-200/90"],
  ["text-amber-400",     "text-amber-600 dark:text-amber-400"],
  ["text-amber-300",     "text-amber-700 dark:text-amber-300"],
  ["text-amber-200",     "text-amber-800 dark:text-amber-200"],

  ["text-sky-300/90",    "text-sky-800/90 dark:text-sky-300/90"],
  ["text-sky-500",       "text-sky-700 dark:text-sky-500"],
  ["text-sky-400",       "text-sky-700 dark:text-sky-400"],
  ["text-sky-300",       "text-sky-800 dark:text-sky-300"],

  ["text-rose-300/90",   "text-rose-700/90 dark:text-rose-300/90"],
  ["text-rose-200/90",   "text-rose-800/90 dark:text-rose-200/90"],
  ["text-rose-200/80",   "text-rose-800/80 dark:text-rose-200/80"],
  ["text-rose-400",      "text-rose-600 dark:text-rose-400"],
  ["text-rose-300",      "text-rose-700 dark:text-rose-300"],
  ["text-rose-200",      "text-rose-800 dark:text-rose-200"],

  ["text-red-400",       "text-red-600 dark:text-red-400"],
  ["text-red-300",       "text-red-700 dark:text-red-300"],

  ["text-violet-400",    "text-violet-700 dark:text-violet-400"],
  ["text-cyan-300",      "text-cyan-800 dark:text-cyan-300"],
  ["text-orange-300",    "text-orange-700 dark:text-orange-300"],

  // ---- deep tint panels (need a light tint in light mode) ----
  ["bg-sky-950/80",  "bg-sky-200 dark:bg-sky-950/80"],
  ["bg-sky-950/30",  "bg-sky-100 dark:bg-sky-950/30"],
  ["bg-sky-950/20",  "bg-sky-100 dark:bg-sky-950/20"],
  ["bg-sky-900/40",  "bg-sky-100 dark:bg-sky-900/40"],

  ["bg-emerald-950/60",  "bg-emerald-100 dark:bg-emerald-950/60"],
  ["bg-emerald-950/40",  "bg-emerald-100 dark:bg-emerald-950/40"],
  ["bg-emerald-950/30",  "bg-emerald-100 dark:bg-emerald-950/30"],
  ["bg-emerald-900/70",  "bg-emerald-200 dark:bg-emerald-900/70"],
  ["bg-emerald-900/50",  "bg-emerald-100 dark:bg-emerald-900/50"],
  ["bg-emerald-900/40",  "bg-emerald-100 dark:bg-emerald-900/40"],
  ["bg-emerald-800/70",  "bg-emerald-200 dark:bg-emerald-800/70"],
  ["bg-emerald-800/40",  "bg-emerald-100 dark:bg-emerald-800/40"],

  ["bg-red-950/40",  "bg-red-100 dark:bg-red-950/40"],
  ["bg-red-500/10",  "bg-red-100 dark:bg-red-500/10"],

  ["bg-rose-950/70",  "bg-rose-200 dark:bg-rose-950/70"],
  ["bg-rose-950/40",  "bg-rose-100 dark:bg-rose-950/40"],
  ["bg-rose-950/30",  "bg-rose-100 dark:bg-rose-950/30"],
  ["bg-rose-950",     "bg-rose-100 dark:bg-rose-950"],
  ["bg-rose-900/50",  "bg-rose-100 dark:bg-rose-900/50"],

  ["bg-amber-950/80", "bg-amber-200 dark:bg-amber-950/80"],
  ["bg-amber-950/40", "bg-amber-100 dark:bg-amber-950/40"],
  ["bg-amber-950/30", "bg-amber-100 dark:bg-amber-950/30"],
  ["bg-amber-950/20", "bg-amber-100 dark:bg-amber-950/20"],
  ["bg-amber-900/40", "bg-amber-100 dark:bg-amber-900/40"],

  ["bg-orange-900/40", "bg-orange-100 dark:bg-orange-900/40"],
  ["bg-cyan-900/40",   "bg-cyan-100 dark:bg-cyan-900/40"],

  // ---- deep accent borders (need a lighter border in light mode) ----
  ["border-sky-900/60",  "border-sky-200 dark:border-sky-900/60"],
  ["border-sky-900/50",  "border-sky-200 dark:border-sky-900/50"],
  ["border-sky-900/30",  "border-sky-200 dark:border-sky-900/30"],
  ["border-sky-700",     "border-sky-300 dark:border-sky-700"],

  ["border-emerald-800/70", "border-emerald-300/70 dark:border-emerald-800/70"],
  ["border-emerald-700/70", "border-emerald-400/70 dark:border-emerald-700/70"],
  ["border-emerald-800",    "border-emerald-300 dark:border-emerald-800"],
  ["border-emerald-700",    "border-emerald-400 dark:border-emerald-700"],

  ["border-rose-900/70", "border-rose-200/70 dark:border-rose-900/70"],
  ["border-rose-800",    "border-rose-200 dark:border-rose-800"],
  ["border-rose-700",    "border-rose-300 dark:border-rose-700"],

  ["border-red-900",     "border-red-200 dark:border-red-900"],

  ["border-amber-900",        "border-amber-200 dark:border-amber-900"],
  ["border-amber-800/60",     "border-amber-200/60 dark:border-amber-800/60"],
  ["border-amber-700/70",     "border-amber-300/70 dark:border-amber-700/70"],
  ["border-amber-700",        "border-amber-300 dark:border-amber-700"],
  ["border-amber-600/80",     "border-amber-400/80 dark:border-amber-600/80"],
  ["border-amber-600/60",     "border-amber-400/60 dark:border-amber-600/60"],
  ["border-amber-500/70",     "border-amber-400/70 dark:border-amber-500/70"],
  ["border-amber-500/20",     "border-amber-400/20 dark:border-amber-500/20"],
  ["border-amber-400/50",     "border-amber-400/50 dark:border-amber-400/50"],

  ["border-orange-700", "border-orange-300 dark:border-orange-700"],
  ["border-cyan-700",   "border-cyan-300 dark:border-cyan-700"],

  // ---- zinc shades used only as TEXT (light mode needs a dark variant) ----
  ["text-zinc-700",              "text-zinc-600 dark:text-zinc-700"],
  ["border-zinc-900/60",         "border-zinc-700/60 dark:border-zinc-900/60"],
  ["bg-zinc-950/50",             "bg-white/50 dark:bg-zinc-950/50"],
]);

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = dir + "/" + name;
    try {
      if (statSync(path).isDirectory()) out.push(...collect(path));
      else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(path);
    } catch {
      /* skip */
    }
  }
  return out;
}

const files = collect(ROOT);
let total = 0;
let touched = 0;
for (const path of files) {
  let src;
  try { src = readFileSync(path, "utf-8"); } catch { continue; }
  let out = src;
  for (const [from, to] of MAP) {
    // boundary-aware: a bare token must not match a longer suffixed token
    // (e.g. text-emerald-300 must not touch text-emerald-300/90), and the
    // dark: variants we introduce must not be re-matched.
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9./_-])", "g");
    const n = (out.match(re) || []).length;
    if (n) {
      out = out.replace(re, () => to);
      total += n;
    }
  }
  if (out !== src) { writeFileSync(path, out); touched++; }
}

console.log(`accent theme codemod: ${total} class strings updated across ${touched} files`);
