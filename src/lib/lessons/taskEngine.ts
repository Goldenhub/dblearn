/**
 * Phase 6 — weight-light task engine for the Learn curriculum.
 *
 * Every lesson task is a small, deterministic check that can be graded purely
 * in TypeScript — no DuckDB execution, no network, no randomness. This is what
 * keeps the course fast and crash-proof: learners prove understanding with
 * first-principles math and the pure-TS simulation engines, and the heavy
 * DuckDB queries stay confined to the optional capstones (which themselves
 * degrade to structural checks if the wasm glue hiccups).
 *
 * Keep this module free of browser-only / worker-only imports so it can be
 * unit-tested under Node.
 */

import { BTree } from "../engine/btree";
import {
  bufferTrace,
  simulateBufferPool,
  type EvictionPolicy,
} from "../engine/challengeEngine";
import {
  ConcurrencySim,
  type IsolationLevel,
} from "../engine/concurrency";
import {
  analyzeQuery,
  WARNING_LABEL,
  type CatalogTable,
  type QueryAnalysis,
  type WarningCode,
} from "./queryAnalyzer";

/* ------------------------------------------------------------------ *
 * Task definitions
 * ------------------------------------------------------------------ */

export type TaskKind =
  /** Fill a number derived from the storage math (pages for N rows). */
  | "number"
  /** Insert keys into a fresh B-Tree and answer about its shape. */
  | "btree"
  /** Pick the isolation level that satisfies a stated guarantee. */
  | "isolation"
  /** Choose frames (and policy) that hit a target hit ratio / read budget. */
  | "buffer"
  /** Pick the option that explains a stated plan symptom. */
  | "plan-choice"
  /** Write a query; graded on intent, and always explained/analyzed. */
  | "sql";

export interface NumberTask {
  kind: "number";
  prompt: string;
  hint?: string;
  /** Pages required: exact answer the learner must type. */
  answer: number;
  tolerance?: number;
  /** Worked step-by-step calculation (formula → numbers → result), shown
   *  after any attempt so learners see how the answer is derived. */
  work?: string[];
}

export interface BtreeTask {
  kind: "btree";
  prompt: string;
  /** Keys inserted into a fresh tree in this order (defaults to the order typed). */
  keys?: number[];
  order?: 2 | 3;
  /** Answer predicates, each evaluated against a fresh tree of `keys`. */
  check: (shape: BTreeShape) => boolean;
}

export type BTreeShape = {
  height: number;
  nodeCount: number;
  keyCount: number;
  rootKeys: number[];
  rootLeaf: boolean;
  avgFillPct: number;
  hops: number;
};

export interface IsolationTask {
  kind: "isolation";
  prompt: string;
  /** Isolation level(s) that satisfy the stated guarantee (anomaly gone). */
  requires: IsolationLevel[];
  scenario: "dirty_read" | "non_repeatable" | "phantom";
}

export interface BufferTask {
  kind: "buffer";
  prompt: string;
  /** Frames, policy} pairs that must pass. */
  requires: { frames: number; policy: EvictionPolicy }[];
  maxReads?: number;
  minHitRatio?: number;
  /** Require EVERY `requires` config to clear the budget, not just the picked one. */
  requiresAll?: boolean;
}

export interface PlanChoiceTask {
  kind: "plan-choice";
  prompt: string;
  /** The correct option's id. */
  answer: string;
  options: { id: string; label: string }[];
  why: string;
}

export interface SqlTask {
  kind: "sql";
  prompt: string;
  hint?: string;
  /** Canonical correct SQL for this task (used by tests as the passing reference).
   *  Not pre-filled in the editor — learners type their own solution. */
  defaultSql: string;
  /** The "bad" query this lesson starts from: pre-filled in the editor as the
   *  broken state to fix, and analyzed as the Before side of the bad→good animation. */
  vs?: string;
  /** Warnings the submitted query must NOT trigger (the "good" part). */
  mustAvoid?: WarningCode[];
  /** Tables the analyzer knows about (row counts + indexed columns). */
  catalog: CatalogTable[];
  /** Intent check: the submitted query passes iff this returns true. */
  check: (analysis: QueryAnalysis) => boolean;
  /** First-principles explanation shown on pass. */
  why: string;
}

export type LessonTask =
  | NumberTask
  | BtreeTask
  | IsolationTask
  | BufferTask
  | PlanChoiceTask
  | SqlTask;

/* ------------------------------------------------------------------ *
 * Graders
 * ------------------------------------------------------------------ */

export interface TaskResult {
  passed: boolean;
  /** Human explanation of what happened, for the lesson's feedback. */
  detail: string;
  /** Structured side information the lesson can render. */
  data?: unknown;
}

export function gradeTask(task: LessonTask, input: unknown): TaskResult {
  switch (task.kind) {
    case "number":
      return gradeNumber(task, input);
    case "btree":
      return gradeBtree(task);
    case "isolation":
      return gradeIsolation(task, input);
    case "buffer":
      return gradeBuffer(task, input);
    case "plan-choice":
      return gradePlanChoice(task, input);
    case "sql":
      return gradeSql(task, input);
    default:
      return { passed: false, detail: "Unknown task kind" };
  }
}

function gradeNumber(task: NumberTask, input: unknown): TaskResult {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value)) return { passed: false, detail: "Type the expected page count." };
  const tolerance = task.tolerance ?? 0;
  const passed = Math.abs(value - task.answer) <= tolerance;
  return {
    passed,
    detail: passed
      ? `Correct — ${task.answer.toLocaleString()} page(s).`
      : `Not quite — the math gives ${task.answer.toLocaleString()} page(s).`,
  };
}

function btreeShapeFromEngine(keys: number[] | undefined, order: 2 | 3): BTreeShape {
  const tree = new BTree(order);
  const input = keys ?? [50, 25, 75, 12, 37, 62, 88];
  for (const k of input) tree.insert(k);
  const snap = tree.snapshot();
  const rootId = snap.rootId;
  const rootNode = snap.nodes.find((n) => n.id === rootId);
  const probe = tree.search(input[0] ?? 0).result;
  const maxKeys = 2 * order - 1;
  return {
    height: snap.height + (snap.nodes.length > 1 ? 1 : 0),
    nodeCount: snap.nodes.length,
    keyCount: snap.totalKeys,
    rootKeys: rootNode?.keys ?? [],
    rootLeaf: rootNode?.leaf ?? true,
    avgFillPct: Math.round((snap.totalKeys / Math.max(1, snap.nodes.length * maxKeys)) * 100),
    hops: probe.hops,
  };
}

function gradeBtree(task: BtreeTask): TaskResult {
  const shape = btreeShapeFromEngine(task.keys, task.order ?? 2);
  const passed = task.check(shape);
  return {
    passed,
    detail: passed
      ? "Verified against a freshly built tree."
      : `That tree is height ${shape.height} with ${shape.nodeCount} node(s) and root keys [${shape.rootKeys.join(", ")}].`,
    data: shape,
  };
}

function gradeIsolation(task: IsolationTask, input: unknown): TaskResult {
  const level = String(input) as IsolationLevel;
  const sim = new ConcurrencySim({
    isolation: level,
    events: ISOLATION_EVENTS[task.scenario],
  });
  const { summary } = sim.run();
  const anomalyPresent = summary.anomalies.length > 0;
  const requiresLevel = task.requires.includes(level);
  const passed = requiresLevel && !anomalyPresent;
  return {
    passed,
    detail: anomalyPresent
      ? `At ${level.toUpperCase().replace("_", " ")} the anomaly still shows up — pick a stronger isolation level.`
      : `At ${level.toUpperCase().replace("_", " ")} the anomaly is gone.`,
    data: summary,
  };
}

function gradeBuffer(task: BufferTask, input: unknown): TaskResult {
  const spec = input as { frames: number; policy: EvictionPolicy } | null;
  if (!spec || !Number.isInteger(spec.frames)) {
    return { passed: false, detail: "Choose a frame count and policy." };
  }
  const trace = bufferTrace();
  const run = simulateBufferPool(trace, spec.frames, spec.policy);
  const withinBudgetFor = (
    r: { frames: number; policy: EvictionPolicy },
  ): boolean => {
    const rRun = simulateBufferPool(trace, r.frames, r.policy);
    return (
      (task.maxReads === undefined || rRun.reads <= task.maxReads) &&
      (task.minHitRatio === undefined || rRun.hitRatio >= task.minHitRatio)
    );
  };
  const withinBudget = withinBudgetFor(spec);
  const matches = task.requires.some(
    (r) => r.frames === spec.frames && r.policy === spec.policy,
  );
  const allClear = !task.requiresAll || task.requires.every(withinBudgetFor);
  const passed = matches && withinBudget && allClear;
  return {
    passed,
    detail: passed
      ? `Verified: ${run.reads} reads, hit ratio ${(run.hitRatio * 100).toFixed(0)}%.`
      : `At ${spec.frames} frame(s) / ${spec.policy}: ${run.reads} reads, hit ratio ${(run.hitRatio * 100).toFixed(0)}%${
          task.requiresAll && !allClear
            ? " — a required policy still busts the budget; try 16 frames, which gives both LRU and Clock headroom."
            : ""
        }.`,
    data: run,
  };
}

function gradePlanChoice(task: PlanChoiceTask, input: unknown): TaskResult {
  const selected = String(input);
  const option = task.options.find((o) => o.id === selected);
  if (!option) return { passed: false, detail: "Pick one of the options." };
  return {
    passed: selected === task.answer,
    detail: selected === task.answer ? task.why : `Not that one. ${option?.label ?? ""} — ${task.why}`,
  };
}

function gradeSql(task: SqlTask, input: unknown): TaskResult {
  const sql = String(input ?? "").trim();
  const before = task.vs ? analyzeQuery(task.vs, task.catalog) : undefined;
  if (!sql) {
    return {
      passed: false,
      detail: "Write a query in the editor, then check it.",
      data: { before, analysis: analyzeQuery(sql, task.catalog) },
    };
  }
  const analysis = analyzeQuery(sql, task.catalog);
  const avoid = (task.mustAvoid ?? []).filter((w) => analysis.warnings.includes(w));
  const passed =
    task.check(analysis) &&
    !analysis.warnings.includes("UNKNOWN_STATEMENT") &&
    analysis.tables.length > 0 &&
    analysis.reads >= 0 &&
    avoid.length === 0;
  return {
    passed,
    detail: passed
      ? task.why
      : avoid.length > 0
        ? `Not yet — your query still triggers ${avoid
            .map((w) => `${w} (${WARNING_LABEL[w]})`)
            .join("; ")}.`
        : "Not quite — read the analysis below to see what your query touches and why it doesn't meet the intent.",
    data: { before, analysis },
  };
}

/* ------------------------------------------------------------------ *
 * Scenario support (mirrors Phase 5's ConcurrencySim events)
 * ------------------------------------------------------------------ */

const ISOLATION_EVENTS: Record<IsolationTask["scenario"], ConstructorParameters<typeof ConcurrencySim>[0]["events"]> = {
  dirty_read: [
    { txnId: "A", op: "begin" },
    { txnId: "B", op: "begin" },
    { txnId: "A", op: "update", rowId: 1, delta: -100 },
    { txnId: "B", op: "select", rowId: 1 },
    { txnId: "B", op: "commit" },
    { txnId: "A", op: "commit" },
  ],
  non_repeatable: [
    { txnId: "A", op: "begin" },
    { txnId: "B", op: "begin" },
    { txnId: "B", op: "select", rowId: 1 },
    { txnId: "A", op: "update", rowId: 1, delta: 100 },
    { txnId: "A", op: "commit" },
    { txnId: "B", op: "select", rowId: 1 },
    { txnId: "B", op: "commit" },
  ],
  phantom: [
    { txnId: "A", op: "begin" },
    { txnId: "B", op: "begin" },
    { txnId: "B", op: "select_range", lo: 1, hi: 99 },
    { txnId: "A", op: "insert", rowId: 6, value: 700 },
    { txnId: "A", op: "commit" },
    { txnId: "B", op: "select_range", lo: 1, hi: 99 },
    { txnId: "B", op: "commit" },
  ],
};