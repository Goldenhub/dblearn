/**
 * Map a DuckDB execution plan tree into a React Flow graph model.
 *
 * Input: the recursive DuckDBPlanNode produced by `EXPLAIN (ANALYZE, FORMAT
 * JSON)` in src/lib/duckdb/db-worker.ts.
 *
 * Output: React Flow nodes (no positions — layout is applied by the graph
 * component, e.g. dagre) and edges, enriched with per-node metrics:
 *  - cost heatmap: each operator's own time as a share of total plan time
 *    (green <10%, amber 10-40%, red >40%)
 *  - data-flow scale: edge stroke width from the source operator's output
 *    cardinality, relative to the plan's largest cardinality
 *  - bottleneck warnings (e.g. SEQ_SCAN_ON_LARGE_TABLE, FILTER_AFTER_SCAN,
 *    CROSS_JOIN, DISK_SPILL)
 */
import type { Edge, Node } from "@xyflow/react";

import type { DuckDBPlanNode } from "@/lib/duckdb/protocol";

export type OperatorCategory =
  | "root"
  | "scan"
  | "join"
  | "aggregate"
  | "sort"
  | "projection"
  | "filter"
  | "limit"
  | "other";

export type WarningCode =
  | "SEQ_SCAN_ON_LARGE_TABLE"
  | "FILTER_AFTER_SCAN"
  | "CROSS_JOIN"
  | "HIGH_TIMING_PCT"
  | "DISK_SPILL";

export type HeatLevel = "low" | "medium" | "high";

export interface PlanNodeMetrics {
  /** Operator own-time in milliseconds (DuckDB `operator_timing`). */
  timingMs: number;
  /** Share of the sum of all operator times, 0-100. */
  timingPct: number;
  heat: HeatLevel;
  /** Rows read by the operator (DuckDB `operator_rows_scanned`). */
  rowsIn: number | null;
  /** Rows emitted by the operator (DuckDB `operator_cardinality`). */
  rowsOut: number | null;
  /** Scalar "cost share" for the node badge (1-100). */
  cost: number;
  warnings: WarningCode[];
}

export interface PlanNodeData {
  /** Short operator name, e.g. "SEQ_SCAN". */
  label: string;
  category: OperatorCategory;
  /** Primary lineUnder the label, e.g. join condition / table name. */
  detail: string;
  /** Secondary detail lines (filters, projections, sort keys, ...). */
  extra: string[];
  /** Table read by a scan operator. */
  table?: string;
  metrics: PlanNodeMetrics;
  /** Original plan node, used by the detail inspector. */
  raw: DuckDBPlanNode;
  [key: string]: unknown;
}

export type PlanFlowNode = Node<PlanNodeData, "plan">;
export type PlanEdge = Edge<{ cardinality: number | null }>;

export interface PlanGraphModel {
  nodes: PlanFlowNode[];
  edges: PlanEdge[];
}

const HEAT_HIGH_PCT = 40;
const HEAT_MEDIUM_PCT = 10;

/** CSS-independent classification of a DuckDB operator name. */
export function categorizeOperator(name: string): OperatorCategory {
  const n = name.toUpperCase();
  if (n.startsWith("EXPLAIN")) return "root";
  if (n.includes("SCAN")) return "scan";
  if (n.includes("JOIN") || n.includes("CROSS_PRODUCT")) return "join";
  if (n.includes("GROUP") || n.includes("AGGREGATE")) return "aggregate";
  if (n.includes("ORDER") || n.startsWith("TOP_N")) return "sort";
  if (n.startsWith("PROJECTION")) return "projection";
  if (n.startsWith("FILTER")) return "filter";
  if (n.startsWith("LIMIT")) return "limit";
  return "other";
}

function heatForPct(pct: number): HeatLevel {
  if (pct >= HEAT_HIGH_PCT) return "high";
  if (pct >= HEAT_MEDIUM_PCT) return "medium";
  return "low";
}

function extraString(info: Record<string, unknown>, key: string): string | null {
  const value = info[key];
  if (typeof value === "string") return value;
  return null;
}

function extraLines(info: Record<string, unknown>, key: string): string[] {
  const value = info[key];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string");
    return parts.length > 0 ? [parts.join(", ")] : [];
  }
  return [];
}

function filtersOf(info: Record<string, unknown>): string[] {
  return extraLines(info, "Filters");
}

function describeCategory(category: OperatorCategory, node: DuckDBPlanNode): {
  detail: string;
  extra: string[];
  table?: string;
} {
  const info = node.extra_info ?? {};
  switch (category) {
    case "scan": {
      const table = extraString(info, "Table");
      const scanType = extraString(info, "Type");
      return {
        detail: scanType ?? "Scan",
        table: table ?? undefined,
        extra: filtersOf(info),
      };
    }
    case "join": {
      const cond = extraString(info, "Conditions") ?? extraString(info, "Cond");
      const joinType = extraString(info, "Join Type");
      return {
        detail: cond ?? (joinType ? `${joinType} join` : ""),
        extra: joinType && cond ? [`${joinType} join`] : [],
      };
    }
    case "aggregate": {
      const groups =
        typeof info.Groups === "string"
          ? [info.Groups]
          : Array.isArray(info.Groups)
            ? info.Groups.map(String)
            : [];
      const projection = extraLines(info, "Projections");
      return {
        detail: groups.length > 0 ? `GROUP BY ${groups.join(", ")}` : "Aggregate",
        extra: projection,
      };
    }
    case "sort": {
      const orderBy = extraString(info, "Order By");
      const top = extraString(info, "Top");
      return {
        detail: top ? `LIMIT ${top}` : "Sort",
        extra: orderBy ? [orderBy] : [],
      };
    }
    case "projection": {
      return {
        detail: "Project columns",
        extra: extraLines(info, "Projections"),
      };
    }
    case "filter": {
      return {
        detail: "Filter rows",
        extra: filtersOf(info),
      };
    }
    default: {
      const keys = Object.keys(info).filter(
        (key) => !/cardinal|estimat/i.test(key),
      );
      return {
        detail: "",
        extra: keys.slice(0, 2).map((key) => `${key}: ${String(info[key]).slice(0, 60)}`),
      };
    }
  }
}

interface InternalEntry {
  node: DuckDBPlanNode;
  category: OperatorCategory;
  detail: string;
  extra: string[];
  table?: string;
  timingMs: number;
  rowsIn: number | null;
  rowsOut: number | null;
  hasFilterParent: boolean;
}

/** Detect spill / external-sort hints in operator extra info. */
function hasSpillHint(node: DuckDBPlanNode): boolean {
  if (!node.extra_info) return false;
  const blob = JSON.stringify(node.extra_info).toLowerCase();
  return /spill|external.*(sort|join)|disk/i.test(blob);
}

/**
 * Flatten the plan tree into node entries and wire the React Flow edges in
 * the same traversal (keeps child indices in plan order).
 */
export function buildPlanModel(plan: DuckDBPlanNode): PlanGraphModel {
  const entries: Array<{
    id: string;
    entry: InternalEntry;
    childIds: string[];
  }> = [];
  let counter = 0;

  const walk = (
    node: DuckDBPlanNode,
    parentHasFilter: boolean,
  ): { id: string; childIds: string[] } => {
    const category = categorizeOperator(node.operator_name);
    const described = describeCategory(category, node);
    const timingMs =
      typeof node.operator_timing === "number" ? node.operator_timing : 0;
    const id = `p-${counter++}`;
    const childIds = node.children.map((child) => walk(child, category === "filter").id);
    entries.push({
      id,
      entry: {
        node,
        category,
        ...described,
        timingMs,
        rowsIn:
          typeof node.operator_rows_scanned === "number"
            ? node.operator_rows_scanned
            : null,
        rowsOut:
          typeof node.operator_cardinality === "number"
            ? node.operator_cardinality
            : null,
        hasFilterParent: parentHasFilter,
      },
      childIds,
    });
    return { id, childIds };
  };

  walk(plan, false);

  const totalTiming = entries.reduce((sum, e) => sum + e.entry.timingMs, 0);
  const scanEntries = entries.filter((e) => e.entry.category === "scan");
  const maxScanRows = Math.max(0, ...scanEntries.map((e) => e.entry.rowsIn ?? 0));

  const nodes: PlanFlowNode[] = [];
  for (const { id, entry } of entries) {
    const timingPct =
      totalTiming > 0 ? (entry.timingMs / totalTiming) * 100 : 0;
    const warnings: WarningCode[] = [];

    if (entry.category === "scan") {
      const biggestScan =
        scanEntries.length > 0 &&
        entry.rowsIn !== null &&
        entry.rowsIn === maxScanRows &&
        maxScanRows > 0;
      if (biggestScan) warnings.push("SEQ_SCAN_ON_LARGE_TABLE");
    }
    if (entry.hasFilterParent && entry.category === "scan") {
      warnings.push("FILTER_AFTER_SCAN");
    }
    if (entry.category === "join") {
      const name = entry.node.operator_name.toUpperCase();
      if (name.includes("CROSS") || name.includes("CROSS_PRODUCT")) {
        warnings.push("CROSS_JOIN");
      }
    }
    if (entry.category !== "root" && timingPct >= HEAT_HIGH_PCT) {
      warnings.push("HIGH_TIMING_PCT");
    }
    if (hasSpillHint(entry.node)) warnings.push("DISK_SPILL");

    nodes.push({
      id,
      type: "plan",
      position: { x: 0, y: 0 },
      data: {
        label: entry.node.operator_name.trim() || "UNKNOWN",
        category: entry.category,
        detail: entry.detail,
        extra: entry.extra,
        table: entry.table,
        metrics: {
          timingMs: entry.timingMs,
          timingPct,
          heat: heatForPct(timingPct),
          rowsIn: entry.rowsIn,
          rowsOut: entry.rowsOut,
          cost: Math.round(timingPct),
          warnings,
        },
        raw: entry.node,
      },
    });
  }

  const edges: PlanEdge[] = [];
  const idOf = (entryId: string) => entryId;
  for (const { id, childIds } of entries) {
    for (const childId of childIds) {
      const childNode = nodes.find((n) => n.id === childId);
      edges.push({
        id: `${idOf(id)}->${childId}`,
        source: idOf(id),
        target: childId,
        type: "default",
        data: { cardinality: childNode?.data.metrics.rowsOut ?? null },
      });
    }
  }

  return { nodes, edges };
}

/** Rescale a cardinality into an edge stroke width (1-7). */
export function edgeStrokeWidth(cardinality: number | null, max: number): number {
  if (cardinality === null || max <= 0) return 1.5;
  const ratio = Math.max(0, Math.min(1, cardinality / max));
  return 1 + ratio * 6;
}

/** The plan's largest intermediate cardinality, for label/edge scaling. */
export function findMaxCardinality(edges: PlanEdge[]): number {
  return Math.max(
    0,
    ...edges.map((e) => e.data?.cardinality ?? 0).filter((v): v is number => typeof v === "number"),
  );
}