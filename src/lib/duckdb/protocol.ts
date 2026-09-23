/**
 * Wire protocol between the main thread and the DuckDB-Wasm worker.
 *
 * These types are shared by src/lib/duckdb/client.ts (main thread) and
 * src/lib/duckdb/db-worker.ts (worker). Keep this file free of browser-only
 * / worker-only imports so both sides can import it.
 */

/** One node of the DuckDB execution plan, as returned by EXPLAIN (FORMAT JSON). */
export interface DuckDBPlanNode {
  /** e.g. "SEQ_SCAN", "HASH_JOIN", "PROJECTION", "TOP_N" (trailing space trimmed). */
  operator_name: string;
  operator_type?: string;
  extra_info?: Record<string, unknown>;
  operator_timing?: number;
  operator_rows_scanned?: number;
  operator_cardinality?: number;
  cumulative_cardinality?: number;
  children: DuckDBPlanNode[];
  [key: string]: unknown;
}

/** Parsed result of `EXPLAIN (ANALYZE, FORMAT JSON) <query>`. */
export interface DuckDBExplainResult {
  /** Root operator of the plan tree. */
  plan: DuckDBPlanNode;
  /** Root-level query latency in ms, when provided by DuckDB. */
  latencyMs: number | null;
  /** Original JSON string returned by DuckDB, for the raw-plan inspector. */
  rawJson: string;
}

/** One materialized row, as plain JSON-safe values. */
export interface QueryRow {
  [column: string]: unknown;
}

export type DuckDBWorkerRequest =
  /** Warm up the engine and seed the demo tables. */
  | { id: number; type: "init" }
  /** Run EXPLAIN (ANALYZE, FORMAT JSON) on `sql`. */
  | { id: number; type: "explain"; sql: string };

export type DuckDBWorkerResponse =
  | { id: number; type: "ready"; engineVersion: string }
  | { id: number; type: "explain-result"; result: DuckDBExplainResult }
  | { id: number; type: "error"; message: string };

/** Lifecycle status surfaced to the UI. */
export type EngineStatus = "idle" | "starting" | "ready" | "error";