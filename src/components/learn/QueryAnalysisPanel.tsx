"use client";

/**
 * Renders a static QueryAnalysis (lib/lessons/queryAnalyzer.ts): what the
 * submitted SQL touches, how, at what page-read cost, plus warnings and a
 * plain-English summary. Used by lesson SQL tasks and by the plan/btree
 * challenge workspace so learners always see "what did my query do".
 */

import type { QueryAnalysis, WarningCode } from "@/lib/lessons/queryAnalyzer";
import { WARNING_LABEL } from "@/lib/lessons/queryAnalyzer";

const WARNING_ORDER: WarningCode[] = [
  "SEQUENTIAL_SCAN_ON_LARGE_TABLE",
  "FILTER_MISSING_INDEX",
  "N_PLUS_ONE",
  "UNFILTERED_DELETE",
  "UNFILTERED_UPDATE",
  "LIKE_LEADING_WILDCARD",
  "EXPRESSION_ON_INDEXED_COLUMN",
  "SELECT_STAR_ON_LARGE_TABLE",
  "UNKNOWN_STATEMENT",
];

export default function QueryAnalysisPanel({ analysis }: { analysis: QueryAnalysis }) {
  if (!analysis) return null;
  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-100 dark:bg-sky-950/20 px-3 py-2.5 text-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
          Query analysis
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">
          {analysis.statement} · {fmt(analysis.reads)} reads · {fmt(analysis.writes)} writes ≈{" "}
          {analysis.estimatedMs.toFixed(1)} ms
        </span>
      </div>

      {analysis.tables.length > 0 ? (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wider text-zinc-600">
              <th className="py-0.5 pr-2 font-normal">table</th>
              <th className="px-2 py-0.5 font-normal">access</th>
              <th className="px-2 py-0.5 font-normal">pages</th>
              <th className="px-2 py-0.5 font-normal">filters</th>
            </tr>
          </thead>
          <tbody className="font-mono text-zinc-300">
            {analysis.tables.map((t) => (
              <tr key={t.name} className="border-t border-sky-200 dark:border-sky-900/30">
                <td className="py-1 pr-2 text-zinc-200">{t.name}</td>
                <td className="px-2 py-1">
                  <span
                    className={`rounded px-1 py-0.5 text-[9px] font-semibold ${
                      t.mode === "index"
                        ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {t.mode === "index" ? "INDEX" : "SEQ"}
                  </span>
                </td>
                <td className="px-2 py-1">{fmt(t.pages)}</td>
                <td className="px-2 py-1 text-zinc-400">
                  {t.filterColumns.length ? t.filterColumns.join(", ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[11px] text-zinc-500">No catalog tables touched.</p>
      )}

      {analysis.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {WARNING_ORDER.filter((w) => analysis.warnings.includes(w)).map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[11px] text-rose-700/90 dark:text-rose-300/90">
              <span className="mt-0.5">⚠</span>
              <span>
                <span className="font-mono text-rose-800 dark:text-rose-200">{w}</span> · {WARNING_LABEL[w]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-[11px] leading-snug text-zinc-400">{analysis.summary}</p>

      <details className="mt-2 rounded-md border border-sky-200 dark:border-sky-900/50 bg-white/50 dark:bg-zinc-950/50 px-2 py-1.5">
        <summary className="cursor-pointer font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-400">
          How this is calculated
        </summary>
        <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] leading-relaxed text-zinc-400">
          {analysis.tables.map((t) => (
            <li key={t.name}>
              {t.name}: {fmt(t.rows)} rows ·{" "}
              {t.mode === "index" ? (
                <>
                  index: ⌈log₅₁₂ {fmt(t.rows)}⌉ + 1 ={" "}
                  <span className="text-zinc-200">{fmt(t.pages)} pages</span>
                </>
              ) : (
                <>
                  seq: ⌈{fmt(t.rows)} ÷ 64⌉ ={" "}
                  <span className="text-zinc-200">{fmt(t.pages)} pages</span>
                </>
              )}
            </li>
          ))}
          <li className="text-zinc-300">
            reads {fmt(analysis.reads)}
            {analysis.writes > 0 ? ` + writes ${fmt(analysis.writes)}` : ""} × 0.1 ms/page ={" "}
            <span className="text-emerald-700 dark:text-emerald-300">{analysis.estimatedMs.toFixed(1)} ms</span>
          </li>
        </ul>
      </details>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}