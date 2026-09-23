"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { PlanGraph } from "@/components/plan-graph";
import { explainSql, initEngine, onEngineStatusChange } from "@/lib/duckdb/client";
import { useTheme } from "@/lib/theme";
import type { DuckDBExplainResult, EngineStatus } from "@/lib/duckdb/protocol";

// Monaco pulls in a large bundle and touches browser APIs — keep it out of SSR.
const SqlEditor = dynamic(() => import("@/components/sql-editor"), { ssr: false });

const SAMPLE_SQL = `-- dblearn: EXPLAIN (ANALYZE, FORMAT JSON) runs entirely in the browser via DuckDB-Wasm.
-- A JOIN over the demo tables (20 customers, 200 orders). Press Cmd/Ctrl+Enter or Run.
SELECT o.order_id, c.name, o.amount
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE c.country = 'US' AND o.amount > 100
ORDER BY o.order_id DESC
LIMIT 50;`;

const STATUS_PILL: Record<EngineStatus, string> = {
  idle: "Engine idle",
  starting: "Engine starting…",
  ready: "",
  error: "Engine error",
};

export default function PlanLab() {
  const { theme } = useTheme();
  const [sql, setSql] = useState<string>(SAMPLE_SQL);
  const [result, setResult] = useState<DuckDBExplainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [wallTimeMs, setWallTimeMs] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const engineReadyRef = useRef<Promise<{ engineVersion: string }> | null>(null);
  const runQueryRef = useRef<() => void>(() => {});

  useEffect(() => {
    const unsubscribe = onEngineStatusChange(setStatus);
    engineReadyRef.current = initEngine().then((info) => {
      setEngineVersion(info.engineVersion);
      return info;
    });
    return unsubscribe;
  }, []);

  async function runQuery() {
    if (running || !sql.trim()) return;
    setRunning(true);
    setError(null);
    try {
      await engineReadyRef.current;
      const t0 = performance.now();
      const explained = await explainSql(sql);
      const wallMs = Math.round((performance.now() - t0) * 100) / 100;
      setResult(explained);
      setWallTimeMs(wallMs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  // Keep the latest handler available to the mount effect via the ref.
  useEffect(() => {
    runQueryRef.current = runQuery;
  });

  // Auto-run the sample query once after mount.
  useEffect(() => {
    const timer = setTimeout(() => runQueryRef.current(), 0);
    return () => clearTimeout(timer);
  }, []);

  const statusPill = status === "ready" ? (engineVersion ? `DuckDB ${engineVersion}` : "Engine ready") : STATUS_PILL[status];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(360px,42%)_1fr] lg:grid-rows-1">
      <section className="flex min-h-0 flex-col border-r border-zinc-800">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-zinc-800 px-3 text-[11px] text-zinc-500">
          <span className="font-mono uppercase tracking-wider">SQL</span>
          <span
            className={`ml-auto rounded-full px-2.5 py-0.5 font-medium ${
              status === "ready"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : status === "error"
                  ? "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {statusPill}
          </span>
          <button
            onClick={() => void runQuery()}
            disabled={running}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {running ? "Running…" : "Run ⏎"}
          </button>
        </div>
        {wallTimeMs !== null && result ? (
          <div className="flex h-8 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/40 px-3 text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">plan built in {wallTimeMs.toFixed(2)} ms</span>
            {result.latencyMs !== null ? (
              <span className="ml-auto text-zinc-500">execution latency {result.latencyMs.toFixed(2)} ms</span>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <SqlEditor value={sql} onChange={setSql} dark={theme === "dark"} />
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-zinc-800 px-3 text-[11px] text-zinc-500">
          <span className="font-mono uppercase tracking-wider">Execution plan</span>
          {result ? (
            <span className="ml-auto text-zinc-400">
              {result.latencyMs !== null ? `latency ${result.latencyMs.toFixed(2)} ms` : ""}
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="shrink-0 border-b border-red-200 dark:border-red-900 bg-red-100 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <PlanGraph result={result} />
        </div>
      </section>
    </div>
  );
}