"use client";

/**
 * Detail drawer shown when a plan node is clicked.
 *
 * Layers three views on top of the raw plan JSON: execution timing metrics,
 * bottleneck warnings (each with a first-principles explanation), and
 * operator-specific database tips.
 */
import { useMemo } from "react";

import type { PlanNodeData } from "@/lib/parser/planMapper";
import { planTipsFor, tipForWarning } from "@/lib/parser/planTips";
import { WARNING_LABELS } from "@/components/nodes/CustomPlanNode";

function formatRows(value: number | null): string {
  if (value === null) return "n/a";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMs(value: number): string {
  if (value >= 1) return `${value.toFixed(1)} ms`;
  if (value >= 0.001) return `${(value * 1000).toFixed(1)} µs`;
  return `${value.toFixed(4)} ms`;
}

const HEAT_TEXT: Record<string, string> = {
  low: "text-emerald-700 dark:text-emerald-300",
  medium: "text-amber-700 dark:text-amber-300",
  high: "text-red-700 dark:text-red-300",
};

const HEAT_LABEL: Record<string, string> = {
  low: "under 10% of plan time",
  medium: "10-40% of plan time",
  high: "over 40% of plan time",
};

function Metric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-sm text-zinc-100 ${className}`}>
        {value}
      </div>
    </div>
  );
}

export function PlanInspector({
  node,
  onClose,
}: {
  node: PlanNodeData;
  onClose: () => void;
}) {
  const { label, category, detail, table, extra, metrics, raw } = node;
  const rawJson = useMemo(() => JSON.stringify(raw, null, 2), [raw]);
  const tips = useMemo(() => planTipsFor(raw), [raw]);

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[min(420px,85%)] flex-col border-l border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zinc-100">
              {label}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                metrics.heat === "low"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : metrics.heat === "medium"
                    ? "bg-amber-400/10 text-amber-700 dark:text-amber-300"
                    : "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300"
              }`}
              title={HEAT_LABEL[metrics.heat]}
            >
              {metrics.timingPct.toFixed(0)}%
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-500">
            {raw.operator_type ?? "operator"}
            {category === "scan" && table ? ` · table ${table}` : ""}
            {category === "join" ? ` · ${detail || "join"}` : ""}
            {HEAT_LABEL[metrics.heat]}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close inspector"
          className="ml-3 rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Esc
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Operator time" value={formatMs(metrics.timingMs)} />
            <Metric
              label="Share of plan"
              value={`${metrics.timingPct.toFixed(1)}%`}
              className={HEAT_TEXT[metrics.heat]}
            />
            <Metric
              label="Rows in"
              value={formatRows(metrics.rowsIn)}
            />
            <Metric
              label="Rows out"
              value={formatRows(metrics.rowsOut)}
            />
          </div>

          {metrics.warnings.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Warnings
              </h3>
              <ul className="space-y-2">
                {metrics.warnings.map((code) => {
                  const tip = tipForWarning(code);
                  return (
                    <li
                      key={code}
                      className="rounded-lg border border-amber-400/20 dark:border-amber-500/20 bg-amber-500/5 px-3 py-2"
                    >
                      <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                        {WARNING_LABELS[code]}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-5 text-zinc-400">
                        {tip.body}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {tips.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                First-principles
              </h3>
              <ul className="space-y-2">
                {tips.map((tip, index) => (
                  <li
                    key={index}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                  >
                    <div className="text-[11px] font-semibold text-zinc-200">
                      {tip.title}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-5 text-zinc-400">
                      {tip.body}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {extra.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Operator detail
              </h3>
              <ul className="space-y-1">
                {extra.map((line, index) => (
                  <li
                    key={index}
                    className="rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Raw plan attributes
            </h3>
            <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-[10px] leading-4 text-zinc-400">
              {rawJson}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PlanInspector;