/**
 * Phase 6 — Challenge engine & evaluator.
 *
 * A challenge is a "broken production scenario" with a set of checkable
 * assertions. Submissions vary by category:
 *
 *   plan / btree → an SQL rewrite (optionally plus an index choice)
 *   concurrency  → a global lock-ordering discipline
 *   buffer       → buffer-pool frame count + eviction policy
 *
 * Challenge grading is a *weight-light closed-form I/O model*: reads, scan
 * modes and result-set shape are derived statically from the seeded row
 * counts and the submission's SQL text — DuckDB-Wasm is never executed here.
 * (The live `EXPLAIN (ANALYZE, FORMAT JSON)` engine proved unreliable in the
 * browser on the heavy seed tables — an un-catchable Emscripten `_setThrew`
 * crash kills the worker — so the capstones grade deterministically instead,
 * and the real EXPLAIN plan stays available in the Query Plan lab.)
 *
 * Everything is deterministic: seeded pseudo-random traces, closed-form
 * costs, pure-TS lock simulation. This module must stay free of browser-only
 * imports so it can be unit-tested under Node.
 */

import { ConcurrencySim, type IsolationLevel, type SimEvent } from "./concurrency";
import type { DuckDBPlanNode, QueryRow } from "../duckdb/protocol";

/* ------------------------------------------------------------------ *
 * Reference storage math (documented on every visual)
 * ------------------------------------------------------------------ */

export const PAGE_BYTES = 8192;
export const ROW_BYTES = 128;
export const BTREE_FANOUT = 512;
export const PAGE_IO_MS = 0.1;

/** Rows that physically fit on one 8 KiB page at 128 B/row. */
export const ROWS_PER_PAGE = PAGE_BYTES / ROW_BYTES; // 64

export function seqPageCount(rows: number): number {
  return Math.max(1, Math.ceil(rows / ROWS_PER_PAGE));
}

/** Pages touched by a point B-Tree lookup: index-height levels + the data page. */
export function indexLookupPageCount(rows: number): number {
  if (rows <= 0) return 1;
  const levels = Math.max(1, Math.ceil(Math.log(rows) / Math.log(BTREE_FANOUT)));
  return levels + 1;
}

/* ------------------------------------------------------------------ *
 * Buffer-pool model (LRU + Clock sweep)
 * ------------------------------------------------------------------ */

export type EvictionPolicy = "lru" | "clock";

export interface BufferAccess {
  page: number;
  read: boolean;
  hit: boolean;
  evicted: number | null;
  evictDirty: boolean;
}

export interface BufferRun {
  reads: number;
  writes: number;
  hits: number;
  misses: number;
  hitRatio: number;
  accesses: BufferAccess[];
}

/**
 * Deterministic LRU / second-chance Clock model over a fixed page trace.
 * Pages go dirty after a write; only dirty pages write back on eviction.
 */
export function simulateBufferPool(
  trace: { page: number; read: boolean }[],
  frames: number,
  policy: EvictionPolicy,
): BufferRun {
  const inMem = new Map<number, { dirty: boolean }>();
  const lruRank = new Map<number, number>(); // page -> recency rank (LRU)
  const refBits = new Map<number, number>(); // page -> reference bit (Clock)
  const slots: (number | null)[] = Array.from({ length: frames }, () => null);
  let hand = 0;
  let reads = 0;
  let writes = 0;
  let hits = 0;
  const accesses: BufferAccess[] = [];

  trace.forEach((acc, i) => {
    const slot = slots.indexOf(acc.page);
    if (slot !== -1) {
      hits += 1;
      lruRank.set(acc.page, i);
      refBits.set(acc.page, 1);
      if (!acc.read) inMem.get(acc.page)!.dirty = true;
      accesses.push({ page: acc.page, read: acc.read, hit: true, evicted: null, evictDirty: false });
      return;
    }

    // Miss: fetch the page from disk.
    reads += 1;
    let target = -1;
    const full = slots.every((p) => p !== null);
    if (full) {
      if (policy === "lru") {
        let oldest = Infinity;
        for (let i = 0; i < frames; i += 1) {
          const rank = lruRank.get(slots[i] as number) ?? Infinity;
          if (rank < oldest) {
            oldest = rank;
            target = i;
          }
        }
      } else {
        // Clock sweep: advance the hand until a page with a clear reference
        // bit is found, clearing bits as we pass (one "second chance" lap).
        for (let laps = 0; laps <= frames; laps += 1) {
          const idx = (hand + laps) % frames;
          const page = slots[idx] as number;
          if ((refBits.get(page) ?? 0) === 0) {
            target = idx;
            break;
          }
          refBits.set(page, 0);
        }
        if (target < 0) target = hand % frames;
        hand = (target + 1) % frames;
      }
      const evicted = slots[target] as number;
      const meta = inMem.get(evicted);
      const evictDirty = meta?.dirty ?? false;
      if (evictDirty) writes += 1;
      inMem.delete(evicted);
      refBits.delete(evicted);
      lruRank.delete(evicted);
      slots[target] = acc.page;
      accesses.push({ page: acc.page, read: acc.read, hit: false, evicted, evictDirty });
    } else {
      const free = slots.findIndex((p) => p === null);
      slots[free] = acc.page;
      accesses.push({ page: acc.page, read: acc.read, hit: false, evicted: null, evictDirty: false });
    }
    inMem.set(acc.page, { dirty: !acc.read });
    lruRank.set(acc.page, i);
    refBits.set(acc.page, 1);
  });

  return {
    reads,
    writes,
    hits,
    misses: reads,
    hitRatio: trace.length === 0 ? 0 : hits / trace.length,
    accesses,
  };
}

/* ------------------------------------------------------------------ *
 * Deadlock model — builds a lock-ordering script from a global order
 * ------------------------------------------------------------------ */

export type LockOrdering = "asc" | "desc" | "mixed";

export interface DeadlockRun {
  deadlocks: number;
  txnCommitted: Record<string, boolean>;
  steps: string[]; // abbreviated run trace for the UI
}

/**
 * Classic two-op lock-order script: A takes rows [1,2], B takes rows [2,1].
 * "mixed" is the broken production state (A asc, B desc) which deadlocks.
 */
export function buildDeadlockScript(ordering: LockOrdering) {
  const aOrder = ordering === "mixed" ? [1, 2] : ordering === "asc" ? [1, 2] : [2, 1];
  const bOrder = ordering === "mixed" ? [2, 1] : ordering === "asc" ? [1, 2] : [2, 1];
  return [
    { txnId: "A" as const, op: "begin" as const },
    { txnId: "B" as const, op: "begin" as const },
    { txnId: "A" as const, op: "update" as const, rowId: aOrder[0], delta: 10 },
    { txnId: "B" as const, op: "update" as const, rowId: bOrder[0], delta: 10 },
    { txnId: "A" as const, op: "update" as const, rowId: aOrder[1], delta: 10 },
    { txnId: "A" as const, op: "commit" as const },
    { txnId: "B" as const, op: "update" as const, rowId: bOrder[1], delta: 10 },
    { txnId: "B" as const, op: "commit" as const },
  ];
}

export function runDeadlockModel(ordering: LockOrdering): DeadlockRun {
  const { steps, summary } = new ConcurrencySim({
    isolation: "repeatable_read",
    events: buildDeadlockScript(ordering),
  }).run();
  const deadlocks = summary.anomalies.filter((a) => a.kind === "deadlock").length;
  const final = steps[steps.length - 1]?.state;
  const txnCommitted: Record<string, boolean> = {};
  for (const t of ["A", "B", "C"] as const) {
    txnCommitted[t] = final?.txns.find((x) => x.id === t)?.status === "committed";
  }
  return {
    deadlocks,
    txnCommitted,
    steps: steps.map((s, i) => `${i}:${s.txnId}:${s.kind}`),
  };
}

/**
 * N+1 read cost: one full inner-table scan per outer row. Outer = the larger
 * seeded table (range scans chew the whole table either way), inner = the
 * smaller one being re-probed per row.
 */
export function correlatedReadCount(rowCounts: Record<string, number>): number {
  const rows = Object.values(rowCounts);
  const outer = Math.max(1, ...rows);
  const inner = Math.max(1, ...rows.filter((r) => r < outer), 1);
  return outer * seqPageCount(inner);
}

/* ------------------------------------------------------------------ *
 * Result-set comparison
 * ------------------------------------------------------------------ */

export function normalizeRows(rows: QueryRow[]): string[] {
  return rows
    .map((r) =>
      Object.keys(r)
        .sort()
        .map((k) => {
          const v = r[k];
          if (v === null || v === undefined) return `${k}=`;
          if (typeof v === "number") return `${k}=${v}`;
          if (typeof v === "bigint") return `${k}=${String(v)}`;
          return `${k}=${JSON.stringify(String(v))}`;
        })
        .join("|"),
    )
    .sort();
}

export function rowsMatch(a: QueryRow[], b: QueryRow[]): boolean {
  const na = normalizeRows(a);
  const nb = normalizeRows(b);
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i += 1) if (na[i] !== nb[i]) return false;
  return true;
}

/** Loose structural check: does this SQL run a correlated scalar subquery per outer row? */
export function usesCorrelatedSubquery(sql: string): boolean {
  const body = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  const re = /\(\s*select\s+[^)]*?from\s+(\w+)(\s+(?:as\s+)?\w+)?[\s\S]*?where\s+(\w+)\.\w+\s*=\s*(\w+)\./gi;
  const m = re.exec(body);
  if (!m) return false;
  const [, innerTable, aliasRaw, lhs, rhs] = m;
  const innerAlias = aliasRaw ? aliasRaw.trim().replace(/^as\s+/i, "") : innerTable;
  // Correlated iff the WHERE binds the inner table's alias to a different,
  // outer alias (i.e. the inner lookup depends on each outer row).
  return lhs === innerAlias && rhs !== innerTable && rhs !== innerAlias;
}

/* ------------------------------------------------------------------ *
 * Challenge schema
 * ------------------------------------------------------------------ */

export type ChallengeCategory = "plan" | "btree" | "concurrency" | "buffer";

export type AssertionKind =
  | "MAX_EXECUTION_TIME_MS"
  | "MAX_DISK_READS"
  | "EXPECTED_NODE_TYPE"
  | "NO_DEADLOCKS"
  | "NO_DIRTY_READS"
  | "RESULT_SET_MATCH";

export interface Assertion {
  kind: AssertionKind;
  target?: number;
  op?: "seq" | "index";
  message: string;
}

export interface Hint {
  id: string;
  text: string;
  penalty?: number;
}

export interface Challenge {
  id: string;
  title: string;
  category: ChallengeCategory;
  difficulty: 1 | 2 | 3;
  story: string;
  issue: string;
  schema: { name: string; detail: string }[];
  goals: string[];
  hints: Hint[];
  solution: string;
  firstPrinciples: string;
  assertions: Assertion[];
  /** Baseline config — the broken state the learner starts from. */
  defaultSubmission: ChallengeSubmission;
  /** SQL executed once to prepare this challenge's tables (plan/btree only). */
  setupSql?: string[];
  referenceSql?: string;
  /** Expected canonical result set (used instead of running reference SQL). */
  expectedResult?: QueryRow[];
  /** Exact row counts seeded by setupSql — drive the closed-form I/O model. */
  rowCounts?: Record<string, number>;
}

export type ChallengeSubmission =
  | { kind: "sql"; sql: string; indexColumn: string | null }
  | { kind: "isolation"; isolation: IsolationLevel }
  | { kind: "buffer"; frameCount: number; policy: EvictionPolicy }
  | { kind: "locks"; ordering: LockOrdering };

export interface ChallengeMetrics {
  reads: number;
  writes: number;
  estimatedTimeMs: number;
  realTimeMs: number;
  rowsScanned: number;
  hitRatio: number;
  deadlocks: number;
  dirtyReads: number;
  scanMode: "seq" | "index" | "none";
}

export interface AssertionResult {
  passed: boolean;
  kind: AssertionKind;
  message: string;
  actual: string;
  target: string;
}

export interface ChallengeVisualPayload {
  planJson?: DuckDBPlanNode | null;
  deadlock?: DeadlockRun;
  buffer?: BufferRun;
  resultSet?: { columns: string[]; rows: QueryRow[]; rowsAvailable?: boolean };
}

export interface Evaluation {
  passed: boolean;
  stars: 1 | 2 | 3;
  efficiency: number;
  score: number;
  hintsUsed: number;
  attempts: number;
  metrics: ChallengeMetrics;
  baseline: ChallengeMetrics;
  diff: {
    readsX: number;
    timeX: number;
    hitRatioDelta: number;
    deadlockRemoved: boolean;
  };
  assertionResults: AssertionResult[];
  failures: string[];
  payload: ChallengeVisualPayload;
}

const EMPTY_METRICS: ChallengeMetrics = {
  reads: 0,
  writes: 0,
  estimatedTimeMs: 0,
  realTimeMs: 0,
  rowsScanned: 0,
  hitRatio: 0,
  deadlocks: 0,
  dirtyReads: 0,
  scanMode: "none",
};

/* ------------------------------------------------------------------ *
 * Per-category evaluation
 * ------------------------------------------------------------------ */

async function evalPlanLike(
  challenge: Challenge,
  submission: Extract<ChallengeSubmission, { kind: "sql" }>,
): Promise<{ metrics: ChallengeMetrics; payload: ChallengeVisualPayload }> {
  const rowCounts = challenge.rowCounts ?? {};
  let reads = 0;
  let rowsScanned = 0;
  let scanMode: "seq" | "index" = "seq";

  if (challenge.id === "n_plus_one") {
    // One full inner-table scan per outer row.
    const outer = Math.max(1, ...Object.values(rowCounts), 1);
    const inner = Math.max(1, ...Object.values(rowCounts).filter((r) => r < outer), 1);
    rowsScanned = outer;
    if (usesCorrelatedSubquery(submission.sql)) {
      reads = correlatedReadCount(rowCounts);
      scanMode = "seq";
    } else {
      // A JOIN reads each input once (indexed on the join key → a few pages).
      reads = seqPageCount(inner) + indexLookupPageCount(outer);
      scanMode = "index";
    }
  } else {
    const filterColumn = filterColumnFor(challenge);
    const table = challenge.id === "missing_index" ? "events" : Object.keys(rowCounts)[0] ?? "t";
    const n = rowCounts[table] ?? 1;
    rowsScanned = n;
    const indexUsable =
      submission.indexColumn !== null &&
      submission.indexColumn === filterColumn &&
      filterColumn !== null &&
      structuralFiltersOn(challenge, submission.sql);
    reads = indexUsable ? indexLookupPageCount(n) : seqPageCount(n);
    scanMode = indexUsable ? "index" : "seq";
  }

  const metrics: ChallengeMetrics = {
    reads,
    writes: 0,
    estimatedTimeMs: reads * PAGE_IO_MS,
    realTimeMs: NaN,
    rowsScanned,
    hitRatio: 0,
    deadlocks: 0,
    dirtyReads: 0,
    scanMode,
  };
  return {
    metrics,
    payload: {
      planJson: null,
      resultSet: { columns: [], rows: [], rowsAvailable: false },
    },
  };
}

/** Does the SQL structurally filter on the challenge's indexed column? */
function structuralFiltersOn(challenge: Challenge, sql: string): boolean {
  switch (challenge.id) {
    case "missing_index":
      return /\buser_id\b/i.test(sql) && /\bwhere\b/i.test(sql);
    default:
      return true;
  }
}

/**
 * Structural fallback for RESULT_SET_MATCH when the live result set can't be
 * materialized (duckdb-wasm `_setThrew` on heavy tables). Verifies the
 * submission's *intent* from the SQL text so learning never blocks on the
 * engine bug.
 */
export function structuralResultPass(challenge: Challenge, submissionSql: string): boolean {
  switch (challenge.id) {
    case "missing_index":
      // Intent: filter on the indexed column and return the referenced row.
      return /\bwhere\b[^)]*user_id/i.test(submissionSql) && /\bid\b/i.test(submissionSql);
    case "n_plus_one":
      return /\bjoin\b/i.test(submissionSql) && !usesCorrelatedSubquery(submissionSql);
    default:
      return true;
  }
}

function filterColumnFor(challenge: Challenge): string | null {
  return challenge.id === "missing_index" ? "user_id" : null;
}

/** Dirty-read scenario: A writes -100 uncommitted, B reads row 1, both commit. */
export const DIRTY_READ_EVENTS: SimEvent[] = [
  { txnId: "A", op: "begin" },
  { txnId: "B", op: "begin" },
  { txnId: "A", op: "update", rowId: 1, delta: -100 },
  { txnId: "B", op: "select", rowId: 1 },
  { txnId: "B", op: "commit" },
  { txnId: "A", op: "commit" },
];

async function evalIsolation(
  submission: Extract<ChallengeSubmission, { kind: "isolation" }>,
): Promise<{ metrics: ChallengeMetrics; payload: ChallengeVisualPayload }> {
  const { steps, summary } = new ConcurrencySim({
    isolation: submission.isolation,
    events: DIRTY_READ_EVENTS,
  }).run();
  const dirty = summary.anomalies.some((a) => a.kind === "dirty");
  const readValue = steps.find((s) => s.kind === "read" && s.read)?.read?.value ?? 500;
  const metrics: ChallengeMetrics = {
    ...EMPTY_METRICS,
    reads: dirty ? 0 : 1,
    dirtyReads: dirty ? 1 : 0,
  };
  return {
    metrics,
    payload: {
      planJson: null,
      resultSet: { columns: ["id", "balance"], rows: [{ id: 1, balance: readValue }] },
    },
  };
}

async function evalBuffer(
  submission: Extract<ChallengeSubmission, { kind: "buffer" }>,
): Promise<{ metrics: ChallengeMetrics; payload: ChallengeVisualPayload }> {
  const buffer = simulateBufferPool(bufferTrace(), submission.frameCount, submission.policy);
  const metrics: ChallengeMetrics = {
    reads: buffer.reads,
    writes: buffer.writes,
    estimatedTimeMs: (buffer.reads + buffer.writes) * PAGE_IO_MS,
    realTimeMs: NaN,
    rowsScanned: 0,
    hitRatio: buffer.hitRatio,
    deadlocks: 0,
    dirtyReads: 0,
    scanMode: "none",
  };
  return { metrics, payload: { buffer } };
}

async function evalLocks(
  submission: Extract<ChallengeSubmission, { kind: "locks" }>,
): Promise<{ metrics: ChallengeMetrics; payload: ChallengeVisualPayload }> {
  const dl = runDeadlockModel(submission.ordering);
  const metrics: ChallengeMetrics = {
    ...EMPTY_METRICS,
    deadlocks: dl.deadlocks,
    reads: dl.deadlocks * 100,
  };
  return { metrics, payload: { deadlock: dl } };
}

/** Deterministic thrash-y access pattern for the buffer-pool challenge. */
export function bufferTrace() {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const trace: { page: number; read: boolean }[] = [];
  for (let i = 0; i < 320; i += 1) {
    const r = rand();
    const page = r < 0.75 ? Math.floor(rand() * 8) : Math.floor(rand() * 64);
    const read = r > 0.9;
    trace.push({ page, read });
  }
  return trace;
}

/* ------------------------------------------------------------------ *
 * Full evaluation + scoring
 * ------------------------------------------------------------------ */

export async function evaluateChallenge(
  challenge: Challenge,
  submission: ChallengeSubmission,
  opts: { attempts: number; hintsUsed: number },
): Promise<Evaluation> {
  let metrics: ChallengeMetrics;
  let payload: ChallengeVisualPayload = {};

  if (submission.kind === "sql") {
    const r = await evalPlanLike(challenge, submission);
    metrics = r.metrics;
    payload = r.payload;
  } else if (submission.kind === "isolation") {
    const r = await evalIsolation(submission);
    metrics = r.metrics;
    payload = r.payload;
  } else if (submission.kind === "buffer") {
    const r = await evalBuffer(submission);
    metrics = r.metrics;
    payload = r.payload;
  } else {
    const r = await evalLocks(submission);
    metrics = r.metrics;
    payload = r.payload;
  }

  const baseline = await baselineFor(challenge);
  const assertionResults: AssertionResult[] = [];
  const failures: string[] = [];

  for (const a of challenge.assertions) {
    let passed = false;
    let actual = "";
    let target = "";
    switch (a.kind) {
      case "MAX_EXECUTION_TIME_MS": {
        target = `≤ ${a.target} ms`;
        actual = `${metrics.estimatedTimeMs.toFixed(2)} ms`;
        passed = metrics.estimatedTimeMs <= (a.target ?? Infinity);
        break;
      }
      case "MAX_DISK_READS": {
        target = `≤ ${a.target} reads`;
        actual = `${metrics.reads}`;
        passed = metrics.reads <= (a.target ?? Infinity);
        break;
      }
      case "EXPECTED_NODE_TYPE": {
        target = `scan mode → ${a.op}`;
        actual = metrics.scanMode;
        passed = metrics.scanMode === a.op;
        break;
      }
      case "NO_DEADLOCKS": {
        target = "0 deadlocks";
        actual = `${metrics.deadlocks}`;
        passed = metrics.deadlocks === 0;
        break;
      }
      case "NO_DIRTY_READS": {
        target = "no dirty reads";
        actual = `${metrics.dirtyReads}`;
        passed = metrics.dirtyReads === 0;
        break;
      }
      case "RESULT_SET_MATCH": {
        const candidate = payload.resultSet?.rows ?? [];
        const candidateAvailable = payload.resultSet?.rowsAvailable ?? candidate.length > 0;
        if (candidateAvailable) {
          // Live rows are never produced by the static model today; keep the
          // branch for the (weight-light) future where a tiny dataset runs.
          const reference: QueryRow[] = challenge.expectedResult ?? [];
          passed = rowsMatch(candidate, reference);
          actual = passed ? `${candidate.length} row(s)` : `mismatch (${candidate.length} vs ${reference.length})`;
          target = "matches reference";
        } else if (submission.kind === "sql") {
          // Weight-light fallback: verify intent from SQL structure.
          passed = structuralResultPass(challenge, submission.sql);
          actual = passed ? "verified structurally" : "shape doesn't match the fix";
          target = "matches reference (structural)";
        } else {
          passed = true;
          actual = "n/a";
          target = "matches reference";
        }
        break;
      }
    }
    if (!passed) failures.push(a.message);
    assertionResults.push({ passed, kind: a.kind, message: a.message, actual, target });
  }

  const passed = failures.length === 0;
  const readsX = baseline.reads > 0 ? metrics.reads / baseline.reads : 0;
  const timeX = baseline.estimatedTimeMs > 0 ? metrics.estimatedTimeMs / baseline.estimatedTimeMs : 0;
  const targetEfficiency =
    baseline.hitRatio > 0
      ? Math.max(0, metrics.hitRatio - baseline.hitRatio) * 100
      : Math.max(0, (1 - Math.min(1, readsX)) * 100);
  const efficiency = Math.round(targetEfficiency);
  const hintsPenalty = opts.hintsUsed * 10;
  const score = Math.max(0, (passed ? efficiency : Math.min(efficiency, 40)) - hintsPenalty);
  const stars: 1 | 2 | 3 = passed
    ? opts.attempts <= 1
      ? 3
      : opts.attempts <= 3
        ? 2
        : 1
    : 1;

  return {
    passed,
    stars,
    efficiency,
    score,
    hintsUsed: opts.hintsUsed,
    attempts: opts.attempts,
    metrics,
    baseline,
    diff: {
      readsX,
      timeX,
      hitRatioDelta: metrics.hitRatio - baseline.hitRatio,
      deadlockRemoved: baseline.deadlocks > 0 && metrics.deadlocks === 0,
    },
    assertionResults,
    failures,
    payload,
  };
}

/** Broken/default metrics, recomputed eagerly so diffs always compare fairly. */
export async function baselineFor(challenge: Challenge): Promise<ChallengeMetrics> {
  switch (challenge.defaultSubmission.kind) {
    case "sql": {
      const rowCounts = challenge.rowCounts ?? {};
      if (
        challenge.id === "n_plus_one" &&
        challenge.defaultSubmission.kind === "sql" &&
        usesCorrelatedSubquery(challenge.defaultSubmission.sql)
      ) {
        const reads = correlatedReadCount(rowCounts);
        return {
          reads,
          writes: 0,
          estimatedTimeMs: reads * PAGE_IO_MS,
          realTimeMs: NaN,
          rowsScanned: Math.max(1, ...Object.values(rowCounts), 1),
          hitRatio: 0,
          deadlocks: 0,
          dirtyReads: 0,
          scanMode: "seq",
        };
      }
      const rows = BASELINE_ROWS[challenge.id] ?? 12_000;
      const reads = seqPageCount(rows);
      return {
        reads,
        writes: 0,
        estimatedTimeMs: reads * PAGE_IO_MS,
        realTimeMs: NaN,
        rowsScanned: rows,
        hitRatio: 0,
        deadlocks: 0,
        dirtyReads: 0,
        scanMode: "seq",
      };
    }
    case "isolation":
      return { ...EMPTY_METRICS, reads: 1 };
    case "buffer": {
      const b = simulateBufferPool(bufferTrace(), challenge.defaultSubmission.frameCount, challenge.defaultSubmission.policy);
      return {
        ...EMPTY_METRICS,
        reads: b.reads,
        writes: b.writes,
        hitRatio: b.hitRatio,
        estimatedTimeMs: (b.reads + b.writes) * PAGE_IO_MS,
      };
    }
    case "locks": {
      const dl = runDeadlockModel(challenge.defaultSubmission.ordering);
      return { ...EMPTY_METRICS, deadlocks: dl.deadlocks, reads: dl.deadlocks * 100 };
    }
  }
}

/** Rows the evaluator assumes on disk for each SQL challenge (closed-form teaching baseline). */
const BASELINE_ROWS: Record<string, number> = {
  missing_index: 500_000,
  n_plus_one: 10_000,
};