"use client";

/**
 * Unified React Flow node for every plan operator.
 *
 * One component renders Scans (table + scan type + filters + rows), Joins
 * (join type + conditions + build/probe), and Aggregates/Sorts (keys, sort
 * order, spill hints) with shared Shadcn-style zinc chrome. Category variants
 * stay data-driven via PlanNodeData so no switch on render is needed.
 */
import type { NodeProps } from "@xyflow/react";

import type {
  HeatLevel,
  OperatorCategory,
  PlanFlowNode,
  WarningCode,
} from "@/lib/parser/planMapper";

const CATEGORY_DOT: Record<OperatorCategory, string> = {
  root: "bg-zinc-500",
  scan: "bg-sky-400",
  join: "bg-violet-400",
  aggregate: "bg-fuchsia-400",
  sort: "bg-emerald-400",
  projection: "bg-zinc-400",
  filter: "bg-amber-400",
  limit: "bg-teal-400",
  other: "bg-zinc-500",
};

const HEAT_BORDER: Record<HeatLevel, string> = {
  low: "border-emerald-500/40",
  medium: "border-amber-400/50 dark:border-amber-400/50",
  high: "border-red-500/60",
};

const HEAT_BADGE: Record<HeatLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-400/10 text-amber-700 dark:text-amber-300",
  high: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300",
};

function formatRows(value: number | null): string {
  if (value === null) return "–";
  return new Intl.NumberFormat("en-US").format(value);
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 2 1.5 13.5h13L8 2Z" strokeLinejoin="round" />
      <path d="M8 6v3.4" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function metricLine(category: OperatorCategory): string | null {
  switch (category) {
    case "scan":
      return "rows read";
    case "join":
      return "rows through join";
    case "aggregate":
      return "rows in";
    case "sort":
      return "rows sorted";
    default:
      return "rows";
  }
}

export function CustomPlanNode({ data, selected }: NodeProps<PlanFlowNode>) {
  const { label, category, detail, extra, table, metrics } = data;
  const { heat, timingPct, timingMs, rowsIn, rowsOut, warnings } = metrics;

  const rowLabel =
    category === "scan" ? rowsIn : category === "root" ? null : rowsOut;

  return (
    <div
      className={`w-[228px] rounded-xl border bg-zinc-900/95 shadow-lg shadow-black/40 transition-shadow ${
        selected ? "border-zinc-300 ring-2 ring-zinc-400/30" : HEAT_BORDER[heat]
      }`}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2.5 py-1.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[category]}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold tracking-tight text-zinc-100">
          {label}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${HEAT_BADGE[heat]}`}
          title={`${timingPct.toFixed(1)}% of measured plan time`}
        >
          {timingPct.toFixed(0)}%
        </span>
      </div>

      <div className="space-y-0.5 px-2.5 py-2">
        {table ? (
          <div className="truncate font-mono text-[11px] text-sky-800/90 dark:text-sky-300/90">
            table {table}
          </div>
        ) : null}
        {detail ? (
          <div className="truncate font-mono text-[11px] text-zinc-300">
            {detail}
          </div>
        ) : null}
        {extra.map((line, index) => (
          <div
            key={index}
            className="truncate font-mono text-[10px] text-zinc-500"
          >
            {line}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400">
        {rowLabel !== null ? (
          <span>
            {formatRows(rowLabel)} <span className="text-zinc-600">{metricLine(category)}</span>
          </span>
        ) : (
          <span className="text-zinc-600">{timingMs.toFixed(3)} ms</span>
        )}
        {warnings.length > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400">
            <WarningIcon className="h-3 w-3" />
            <span className="text-[10px]">{warnings.length}</span>
          </span>
        ) : (
          <span className="text-zinc-600">{timingMs.toFixed(3)} ms</span>
        )}
      </div>
    </div>
  );
}

/** Surface a human-readable warning label for the tooltip/inspector. */
export const WARNING_LABELS: Record<WarningCode, string> = {
  SEQ_SCAN_ON_LARGE_TABLE: "Large table scanned fully",
  FILTER_AFTER_SCAN: "Filter applied after scan",
  CROSS_JOIN: "Cartesian product",
  HIGH_TIMING_PCT: "Hotspot operator",
  DISK_SPILL: "Spilled to disk",
};

export default CustomPlanNode;