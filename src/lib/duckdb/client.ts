/**
 * Main-thread bridge to the DuckDB-Wasm worker.
 *
 * Lazily spawns src/lib/duckdb/db-worker.ts, pairs responses to requests by
 * id, and exposes a small promise-based API. All heavy lifting happens in the
 * worker so the UI thread never blocks.
 */
import type {
  DuckDBExplainResult,
  DuckDBWorkerRequest,
  DuckDBWorkerResponse,
} from "./protocol";

type EngineListener = (status: "starting" | "ready" | "error") => void;

let worker: Worker | null = null;
let requestCounter = 0;
const pending = new Map<number, {
  resolve: (message: DuckDBWorkerResponse) => void;
  reject: (error: Error) => void;
}>();
const engineListeners = new Set<EngineListener>();

function notifyEngine(status: "starting" | "ready" | "error"): void {
  for (const listener of engineListeners) listener(status);
}

async function getWorker(): Promise<Worker> {
  if (worker) return worker;

  notifyEngine("starting");
  const spawned = new Worker(new URL("./db-worker.ts", import.meta.url), {
    type: "module",
  });

  spawned.addEventListener("message", (event: MessageEvent<DuckDBWorkerResponse>) => {
    const message = event.data;
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);

    if (message.type === "error") {
      callback.reject(new Error(message.message));
      if (message.id === 0) notifyEngine("error");
      return;
    }
    if (message.type === "ready") notifyEngine("ready");
    callback.resolve(message);
  });

  spawned.addEventListener("error", (event: ErrorEvent) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || "Worker crashed"));
    pending.clear();
    notifyEngine("error");
  });

  worker = spawned;
  return worker;
}

async function request(
  build: (id: number) => DuckDBWorkerRequest,
): Promise<DuckDBWorkerResponse> {
  const spawned = await getWorker();
  const id = ++requestCounter;
  return new Promise<DuckDBWorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    spawned.postMessage(build(id));
  });
}

/** Warm up the engine and seed the demo tables. Safe to call repeatedly. */
export async function initEngine(): Promise<{ engineVersion: string }> {
  const message = await request((id) => ({ id, type: "init" }));
  switch (message.type) {
    case "ready":
      return { engineVersion: message.engineVersion };
    case "error":
      throw new Error(message.message);
    case "explain-result":
      throw new Error("Unexpected result for init request");
  }
}

/**
 * Run `EXPLAIN (ANALYZE, FORMAT JSON) <sql>` in the worker and return the
 * parsed plan.
 */
export async function explainSql(sql: string): Promise<DuckDBExplainResult> {
  const message = await request((id) => ({ id, type: "explain", sql }));
  switch (message.type) {
    case "explain-result":
      return message.result;
    case "ready":
      throw new Error("Unexpected message for explain request");
    case "error":
      throw new Error(message.message);
  }
}

/** Subscribe to engine lifecycle changes. Returns an unsubscribe fn. */
export function onEngineStatusChange(listener: EngineListener): () => void {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

/** Tear the worker down (e.g. hot-reload safety). */
export function resetWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}