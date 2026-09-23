/**
 * DuckDB-Wasm engine worker.
 *
 * Runs the actual query engine inside a Web Worker (the "no backend" rule).
 * Because @duckdb/duckdb-wasm 1.32 crashes (Emscripten `_setThrew`) on the
 * unparenthesized form `EXPLAIN ANALYZE FORMAT JSON`, plans are produced with
 * the equivalent parenthesized form `EXPLAIN (ANALYZE, FORMAT JSON)`.
 *
 * The worker exposes exactly two messages — `init` (boot + seed demo tables)
 * and `explain` (one ANALYZE EXPLAIN) — matching the plan lab's needs. Challenge
 * grading never reaches here: it is a pure-TS closed-form model (see
 * lib/engine/challengeEngine.ts), because materializing queries over heavy seed
 * tables kill the wasm worker with the same un-catchable `_setThrew` error.
 *
 * Engine assets live in public/db (copied from node_modules by
 * scripts/copy-duckdb-assets.mjs); the mvp bundle needs no Cross-Origin
 * Isolation / SharedArrayBuffer.
 */
import * as duckdb from "@duckdb/duckdb-wasm";

import type { DuckDBPlanNode } from "./protocol";
import type {
  DuckDBExplainResult,
  DuckDBWorkerRequest,
  DuckDBWorkerResponse,
} from "./protocol";

const WASM_URL = "/db/duckdb-mvp.wasm";
const ENGINE_WORKER_URL = "/db/duckdb-browser-mvp.worker.js";

const DEMO_TABLES_SQL = [
  `CREATE OR REPLACE TABLE customers (
     id INT,
     name VARCHAR,
     country VARCHAR
   )`,
  `CREATE OR REPLACE TABLE orders (
     order_id INT,
     customer_id INT,
     amount DOUBLE
   )`,
  `INSERT INTO customers
     SELECT i, 'customer_' || i,
            CASE WHEN i % 2 = 0 THEN 'US' ELSE 'DE' END
     FROM range(20) t(i)`,
  `INSERT INTO orders
     SELECT i, i % 20, (i * 1.5) * 100
     FROM range(200) t(i)`,
];

let engineReady: Promise<duckdb.AsyncDuckDB> | null = null;

function postMessage(message: DuckDBWorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

/**
 * Lazily boot the engine exactly once. The memoized promise resolves only
 * after `instantiate()` completes, so concurrent callers (StrictMode double
 * `init`, an `explain` racing `init`) can never issue worker tasks against a
 * not-yet-initialized engine.
 */
function ensureEngine(): Promise<duckdb.AsyncDuckDB> {
  if (!engineReady) {
    engineReady = (async () => {
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR);
      const engineWorker = new Worker(ENGINE_WORKER_URL);
      const instance = new duckdb.AsyncDuckDB(logger, engineWorker);
      await instance.instantiate(WASM_URL);
      return instance;
    })();
  }
  return engineReady;
}

/** Make the plan JSON from DuckDB conform to DuckDBPlanNode. */
function normalizePlan(raw: string): DuckDBExplainResult {
  const parsed = JSON.parse(raw) as Record<string, unknown> & {
    children?: Array<Record<string, unknown>>;
    latency?: number;
  };

  const rootNode = (parsed.children?.[0] ?? parsed) as Record<string, unknown>;
  const mapNode = (node: Record<string, unknown>): DuckDBPlanNode => ({
    operator_name: String(node.operator_name ?? "UNKNOWN").trim(),
    operator_type: node.operator_type as string | undefined,
    extra_info: node.extra_info as Record<string, unknown> | undefined,
    operator_timing: node.operator_timing as number | undefined,
    operator_rows_scanned: node.operator_rows_scanned as number | undefined,
    operator_cardinality: node.operator_cardinality as number | undefined,
    cumulative_cardinality: node.cumulative_cardinality as number | undefined,
    children: Array.isArray(node.children)
      ? (node.children as Array<Record<string, unknown>>).map(mapNode)
      : [],
  });

  return {
    plan: mapNode(rootNode),
    latencyMs: typeof parsed.latency === "number" ? parsed.latency : null,
    rawJson: raw,
  };
}

async function runExplain(sql: string): Promise<DuckDBExplainResult> {
  const db = await ensureEngine();
  const conn = await db.connect();
  try {
    const trimmed = sql.trim().replace(/;\s*$/, "");
    const wrapped = `EXPLAIN (ANALYZE, FORMAT JSON) ${trimmed}`;
    const table = await conn.query(wrapped);
    const explainValue = table.getChild("explain_value");
    const raw = String(explainValue?.get(0) ?? "");
    return normalizePlan(raw);
  } finally {
    await conn.close();
  }
}

async function seedDemoTables(db: duckdb.AsyncDuckDB): Promise<void> {
  const conn = await db.connect();
  try {
    for (const sql of DEMO_TABLES_SQL) {
      await conn.query(sql);
    }
  } finally {
    await conn.close();
  }
}

(self as unknown as Worker).onmessage = async (
  event: MessageEvent<DuckDBWorkerRequest>,
) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "init": {
        const db = await ensureEngine();
        const version = await db.getVersion();
        await seedDemoTables(db);
        postMessage({ id: request.id, type: "ready", engineVersion: version });
        break;
      }
      case "explain": {
        const result = await runExplain(request.sql);
        postMessage({ id: request.id, type: "explain-result", result });
        break;
      }
    }
  } catch (error) {
    postMessage({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};