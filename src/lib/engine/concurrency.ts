/**
 * Phase 5 — Transaction, locking & isolation simulation engine.
 *
 * Model: a single `accounts` table (rows preselected per scenario) shared by
 * multiple clients (A, B, C). The engine applies Two-Phase Locking (2PL) —
 * strict for every write lock on every isolation level; Shared lock lifetime
 * varies by isolation so teaching anomalies show up (or turn into blocks)
 * exactly where the textbooks put them:
 *
 *   read_uncommitted — SELECT takes NO lock; reads whatever is on the page
 *   read_committed   — SELECT takes a Shared lock, reads, releases immediately
 *   repeatable_read  — SELECT takes a Shared lock and holds it to COMMIT
 *   serializable     — same, plus a strong range/predicate lock that blocks
 *                      matching INSERTs (gap/predicate locking)
 *
 * A scenario is a GLOBAL script of `SimEvent`s ("A locks Row A then requests
 * Row B; B locks Row B then requests Row A"). Each tick the engine scans the
 * script and runs the next event whose transaction is runnable; a blocked
 * transaction stays parked in the script and is retried once its hold frees.
 * After every block the Wait-For Graph is checked: a cycle aborts the
 * youngest txn (the one whose request just closed the cycle).
 *
 * Every executed operation emits a step whose snapshot captures the full
 * state (committed rows, dirty writes, granted locks, wait queue, wait-for
 * edges) so the UI is pure replay — same pattern as the B-Tree playback.
 * Isolation is a run-time setting: load one scenario and execute it under
 * each level to watch an anomaly appear or collapse into a block.
 */

export type IsolationLevel =
  | "read_uncommitted"
  | "read_committed"
  | "repeatable_read"
  | "serializable";

export type ClientId = "A" | "B" | "C";

export type OpType =
  | "begin"
  | "select"
  | "select_range"
  | "update"
  | "insert"
  | "commit"
  | "rollback";

export interface SimEvent {
  txnId: ClientId;
  op: OpType;
  rowId?: number;
  value?: number;
  delta?: number;
  lo?: number;
  hi?: number;
}

export type LockMode = "S" | "X";

export interface RowValue {
  id: number;
  value: number;
}

export interface DirtyValue {
  txnId: ClientId;
  rowId: number;
  value: number;
}

export interface LockGrant {
  resourceId: string;
  mode: LockMode;
  txnId: ClientId;
}

export interface QueueEntry {
  resourceId: string;
  mode: LockMode;
  txnId: ClientId;
}

export interface RangeLock {
  lo: number;
  hi: number;
  txnId: ClientId;
  strong: boolean;
}

export type TxnStatus = "active" | "waiting" | "committed" | "aborted";

export interface TxnView {
  id: ClientId;
  status: TxnStatus;
  isolation: IsolationLevel;
  waitingOn: string | null;
  opsDone: number;
}

export interface WaitForEdge {
  from: ClientId;
  to: ClientId;
  resourceId: string;
}

export interface ConcurrencyState {
  tick: number;
  rows: RowValue[];
  dirty: DirtyValue[];
  txns: TxnView[];
  granted: LockGrant[];
  rangeLocks: RangeLock[];
  queue: QueueEntry[];
  waitFor: WaitForEdge[];
}

export type StepKind =
  | "begin"
  | "read"
  | "scan"
  | "write"
  | "insert"
  | "commit"
  | "rollback"
  | "abort"
  | "lock-wait"
  | "deadlock";

export type AnomalyKind = "dirty" | "non-repeatable" | "phantom" | "deadlock";

export interface ReadOutcome {
  rowId: number;
  value: number;
  dirty: boolean;
}

export interface ConcurrencyStep {
  id: number;
  kind: StepKind;
  txnId: ClientId;
  label: string;
  state: ConcurrencyState;
  anomaly: AnomalyKind | null;
  read: ReadOutcome | null;
  scan: { lo: number; hi: number; count: number } | null;
  lock: { resourceId: string; mode: LockMode } | null;
}

export interface WaitSpan {
  txnId: ClientId;
  fromStep: number;
  toStep: number;
  resourceId: string;
}

export interface RunSummary {
  anomalies: { kind: AnomalyKind; txnId: ClientId; detail: string }[];
  waitSpans: WaitSpan[];
}

export interface Scenario {
  id: string;
  title: string;
  recommended: IsolationLevel;
  description: string;
  events: SimEvent[];
}

export const DEFAULT_ROWS: RowValue[] = [1, 2, 3, 4, 5].map((id) => ({
  id,
  value: 500,
}));

export const SCENARIOS: Scenario[] = [
  {
    id: "dirty_read",
    title: "Dirty Read (RU vs RC)",
    recommended: "read_uncommitted",
    description:
      "A writes 400 to account 1 but hasn't committed. B reads it next. Under Read Uncommitted B sees the dirty 400 (no Shared lock); under Read Committed B's Shared request parks on A's Exclusive lock until A commits, so B reads 500.",
    events: [
      { txnId: "A", op: "begin" },
      { txnId: "B", op: "begin" },
      { txnId: "A", op: "update", rowId: 1, delta: -100 },
      { txnId: "B", op: "select", rowId: 1 },
      { txnId: "B", op: "commit" },
      { txnId: "A", op: "commit" },
    ],
  },
  {
    id: "non_repeatable",
    title: "Lost Update / Non-Repeatable Read",
    recommended: "read_committed",
    description:
      "B reads account 1 (500), then A deposits +100 and commits before B reads again. Read Committed lets B see 500 then 600. Repeatable Read holds B's Shared lock, so A's write parks until B commits and both B reads stay 500.",
    events: [
      { txnId: "A", op: "begin" },
      { txnId: "B", op: "begin" },
      { txnId: "B", op: "select", rowId: 1 },
      { txnId: "A", op: "update", rowId: 1, delta: 100 },
      { txnId: "A", op: "commit" },
      { txnId: "B", op: "select", rowId: 1 },
      { txnId: "B", op: "commit" },
    ],
  },
  {
    id: "phantom",
    title: "Phantom Read",
    recommended: "repeatable_read",
    description:
      "B scans accounts 1..99 (5 rows), then A inserts account 6 (value 700) and commits, then B scans again. Repeatable Read only locked the existing rows, so B sees 6 rows. Serializable's range (predicate) lock parks A's insert instead.",
    events: [
      { txnId: "A", op: "begin" },
      { txnId: "B", op: "begin" },
      { txnId: "B", op: "select_range", lo: 1, hi: 99 },
      { txnId: "A", op: "insert", rowId: 6, value: 700 },
      { txnId: "A", op: "commit" },
      { txnId: "B", op: "select_range", lo: 1, hi: 99 },
      { txnId: "B", op: "commit" },
    ],
  },
  {
    id: "deadlock",
    title: "Deadlock & Rollback",
    recommended: "repeatable_read",
    description:
      "A locks account 1, B locks account 2, then each requests the other's row. The Wait-For Graph forms a cycle and the engine aborts the younger txn (B), rolling back its dirty write so A can finish.",
    events: [
      { txnId: "A", op: "begin" },
      { txnId: "B", op: "begin" },
      { txnId: "A", op: "update", rowId: 1, delta: 10 },
      { txnId: "B", op: "update", rowId: 2, delta: 10 },
      { txnId: "A", op: "update", rowId: 2, delta: 10 },
      { txnId: "B", op: "update", rowId: 1, delta: 10 },
      { txnId: "A", op: "commit" },
      { txnId: "B", op: "commit" },
    ],
  },
];

const CLIENT_ORDER: ClientId[] = ["A", "B", "C"];
const RES_ROW = (id: number) => `row:${id}`;
const RES_RANGE = (lo: number, hi: number) => `range:${lo}:${hi}`;

interface TxnInternal {
  id: ClientId;
  isolation: IsolationLevel;
  status: TxnStatus;
  dirty: Map<number, number>;
  granted: string[];
  waitingOn: string | null;
  opsDone: number;
}

function isoName(iso: IsolationLevel): string {
  switch (iso) {
    case "read_uncommitted":
      return "READ UNCOMMITTED";
    case "read_committed":
      return "READ COMMITTED";
    case "repeatable_read":
      return "REPEATABLE READ";
    case "serializable":
      return "SERIALIZABLE";
  }
}

export function isolationLabel(iso: IsolationLevel): string {
  return isoName(iso);
}

export function isolationSummary(iso: IsolationLevel): string {
  switch (iso) {
    case "read_uncommitted":
      return "SELECT takes no locks — dirty reads possible";
    case "read_committed":
      return "short Shared locks — no dirty reads, non-repeatable reads possible";
    case "repeatable_read":
      return "Shared locks held to COMMIT — non-repeatable reads blocked, phantoms possible";
    case "serializable":
      return "Shared + range locks held to COMMIT — phantoms blocked";
  }
}

export function scenarioFor(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

export class ConcurrencySim {
  private rows = new Map<number, number>();
  private grants: LockGrant[] = [];
  private queue: QueueEntry[] = [];
  private rangeLocks: RangeLock[] = [];
  private txns: Record<ClientId, TxnInternal>;
  private isolation: IsolationLevel;
  private script: SimEvent[];
  private stepId = 0;
  private steps: ConcurrencyStep[] = [];
  private anomalies: RunSummary["anomalies"] = [];
  private waitSpans: WaitSpan[] = [];
  private blockStart = new Map<ClientId, { fromStep: number; resourceId: string }>();
  private waitsByStep = new Map<number, { txnId: ClientId; resourceId: string }>();
  private readHistory: Record<ClientId, { rowId: number; value: number }[]> = { A: [], B: [], C: [] };
  private scanHistory: Record<ClientId, { lo: number; hi: number; count: number }[]> = { A: [], B: [], C: [] };
  private readChecked = { A: 0, B: 0, C: 0 };
  private scanChecked = { A: 0, B: 0, C: 0 };

  constructor(opts: {
    isolation: IsolationLevel;
    rows?: RowValue[];
    events: SimEvent[];
  }) {
    this.isolation = opts.isolation;
    for (const r of opts.rows ?? DEFAULT_ROWS) this.rows.set(r.id, r.value);
    this.script = [...opts.events];
    const mk = (id: ClientId): TxnInternal => ({
      id,
      isolation: this.isolation,
      status: "active",
      dirty: new Map(),
      granted: [],
      waitingOn: null,
      opsDone: 0,
    });
    this.txns = { A: mk("A"), B: mk("B"), C: mk("C") };
  }

  run(): { steps: ConcurrencyStep[]; summary: RunSummary } {
    const work = [...this.script];
    for (let guard = 0; guard < 2000 && work.length > 0; guard++) {
      let progressed = false;
      for (let i = 0; i < work.length; i++) {
        const ev = work[i];
        const it = this.txns[ev.txnId];
        if (it.status === "committed" || it.status === "aborted") {
          work.splice(i, 1);
          i -= 1;
          progressed = true;
          continue;
        }
        if (it.waitingOn !== null) continue; // parked until its hold frees
        work.splice(i, 1);
        const outcome = this.executeEvent(ev);
        progressed = true;
        if (outcome === "blocked") work.splice(i, 0, ev); // re-park for retry
        if (outcome === "aborted") break; // victim may have unblocked others: rescan
        break;
      }
      if (!progressed) {
        // Everything left is waiting or finished but not deadlocked — stop.
        break;
      }
    }
    return { steps: this.steps, summary: { anomalies: [...this.anomalies], waitSpans: [...this.waitSpans] } };
  }

  private snapshot(tick: number): ConcurrencyState {
    const dirty: DirtyValue[] = [];
    for (const t of CLIENT_ORDER) {
      for (const [rowId, value] of this.txns[t].dirty) {
        dirty.push({ txnId: t, rowId, value });
      }
    }
    const txns = CLIENT_ORDER.map((t) => {
      const it = this.txns[t];
      return {
        id: t,
        status: (it.waitingOn ? "waiting" : it.status) as TxnStatus,
        isolation: it.isolation,
        waitingOn: it.waitingOn,
        opsDone: it.opsDone,
      };
    });
    return {
      tick,
      rows: cloneRows(this.rows),
      dirty,
      txns,
      granted: [...this.grants],
      rangeLocks: [...this.rangeLocks],
      queue: [...this.queue],
      waitFor: this.buildWaitFor(),
    };
  }

  private pushStep(
    t: ClientId,
    kind: StepKind,
    label: string,
    extra: {
      anomaly?: AnomalyKind | null;
      read?: ReadOutcome | null;
      scan?: ConcurrencyStep["scan"];
      lock?: ConcurrencyStep["lock"];
    } = {},
  ): void {
    this.steps.push({
      id: this.stepId,
      kind,
      txnId: t,
      label,
      state: this.snapshot(this.stepId),
      anomaly: extra.anomaly ?? null,
      read: extra.read ?? null,
      scan: extra.scan ?? null,
      lock: extra.lock ?? null,
    });
    this.stepId += 1;
  }

  private completeOp(t: ClientId): void {
    this.txns[t].opsDone += 1;
    const open = this.blockStart.get(t);
    if (open) {
      this.waitSpans.push({
        txnId: t,
        fromStep: open.fromStep,
        toStep: this.stepId - 1,
        resourceId: open.resourceId,
      });
      this.blockStart.delete(t);
      this.txns[t].waitingOn = null;
    }
  }

  private markBlocked(t: ClientId, resourceId: string, atStep: number): void {
    this.txns[t].waitingOn = resourceId;
    if (!this.blockStart.has(t)) {
      this.blockStart.set(t, { fromStep: atStep, resourceId });
    }
    this.waitsByStep.set(atStep, { txnId: t, resourceId });
  }

  private compatible(a: LockMode, b: LockMode): boolean {
    return a === "S" && b === "S";
  }

  /** FIFO-fair attempt: only the head waiter of a resource can be granted. */
  private drain(resourceId: string): void {
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      if (entry.resourceId !== resourceId) continue;
      const earlier = this.queue.slice(0, i).find((q) => q.resourceId === resourceId);
      if (earlier) continue;
      const holders = this.grants.filter(
        (g) => g.resourceId === resourceId && g.txnId !== entry.txnId,
      );
      if (holders.some((h) => !this.compatible(h.mode, entry.mode))) break;
      if (entry.mode === "X") {
        this.grants = this.grants.filter(
          (g) => !(g.resourceId === resourceId && g.txnId === entry.txnId),
        );
      }
      this.grants.push({ resourceId, mode: entry.mode, txnId: entry.txnId });
      this.queue.splice(i, 1);
      i -= 1;
    }
  }

  /**
   * Acquire a lock or report blocked. Idempotent: re-running the same op must
   * not enqueue duplicates. An S→X upgrade replaces the caller's own Shared
   * grant and queues at the tail (fair, never leapfrogs).
   */
  private tryAcquire(t: ClientId, resourceId: string, mode: LockMode): "granted" | "blocked" {
    const mine = this.grants.find((g) => g.resourceId === resourceId && g.txnId === t);
    if (mine && (mine.mode === mode || mine.mode === "X")) return "granted";
    if (
      this.queue.some(
        (q) => q.resourceId === resourceId && q.txnId === t && q.mode === mode,
      )
    ) {
      this.drain(resourceId);
      const now = this.grants.find((g) => g.resourceId === resourceId && g.txnId === t);
      return now && (now.mode === mode || now.mode === "X") ? "granted" : "blocked";
    }
    this.queue.push({ resourceId, mode, txnId: t });
    this.drain(resourceId);
    const now = this.grants.find((g) => g.resourceId === resourceId && g.txnId === t);
    return now && (now.mode === mode || now.mode === "X") ? "granted" : "blocked";
  }

  /**
   * Wake any transaction parked on `resourceId` so the scheduler retries it.
   * Called after every release (commit / abort / deadlock-victim) — grants
   * may have drained to it, or an op-level gap check (range inserts) may now
   * pass. Also closes that txn's recorded wait span.
   */
  private unpark(resourceId: string): void {
    for (const t of CLIENT_ORDER) {
      const it = this.txns[t];
      if (it.waitingOn !== resourceId) continue;
      const open = this.blockStart.get(t);
      if (open) {
        this.waitSpans.push({
          txnId: t,
          fromStep: open.fromStep,
          toStep: this.stepId,
          resourceId: open.resourceId,
        });
        this.blockStart.delete(t);
      }
      it.waitingOn = null;
    }
  }

  /** Release everything held by t and wake any waiters in the queue. */
  private releaseAll(t: ClientId): { locks: number; ranges: RangeLock[] } {
    const locks = this.grants.filter((g) => g.txnId === t).length;
    const freedRanges = this.rangeLocks.filter((r) => r.txnId === t);
    const freed = new Set<string>();
    for (const g of this.grants) if (g.txnId === t) freed.add(g.resourceId);
    for (const r of freedRanges) freed.add(RES_RANGE(r.lo, r.hi));
    this.grants = this.grants.filter((g) => g.txnId !== t);
    this.rangeLocks = this.rangeLocks.filter((r) => r.txnId !== t);
    this.queue = this.queue.filter((q) => q.txnId !== t);
    for (const res of freed) this.drain(res);
    for (const res of freed) this.unpark(res);
    return { locks, ranges: freedRanges };
  }

  private buildWaitFor(): WaitForEdge[] {
    const edges: WaitForEdge[] = [];
    for (const q of this.queue) {
      for (const h of this.grants) {
        if (h.resourceId !== q.resourceId || h.txnId === q.txnId) continue;
        if (!this.compatible(h.mode, q.mode)) {
          edges.push({ from: q.txnId, to: h.txnId, resourceId: q.resourceId });
        }
      }
    }
    for (const r of this.rangeLocks) {
      for (const t of CLIENT_ORDER) {
        const it = this.txns[t];
        if (t === r.txnId || !r.strong) continue;
        if (it.waitingOn === RES_RANGE(r.lo, r.hi)) {
          edges.push({ from: t, to: r.txnId, resourceId: RES_RANGE(r.lo, r.hi) });
        }
      }
    }
    return edges;
  }

  private detectCycle(): ClientId[] | null {
    const edges = this.buildWaitFor();
    const adj = new Map<ClientId, ClientId[]>();
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
    }
    const visiting = new Set<ClientId>();
    const stack: ClientId[] = [];
    const dfs = (n: ClientId): ClientId[] | null => {
      if (visiting.has(n)) {
        const idx = stack.indexOf(n);
        return idx >= 0 ? stack.slice(idx) : null;
      }
      visiting.add(n);
      stack.push(n);
      for (const m of adj.get(n) ?? []) {
        const c = dfs(m);
        if (c) return c;
      }
      stack.pop();
      visiting.delete(n);
      return null;
    };
    for (const s of CLIENT_ORDER) {
      visiting.clear();
      stack.length = 0;
      const c = dfs(s);
      if (c && c.length >= 2) return c;
    }
    return null;
  }

  private readVisible(t: ClientId, rowId: number): ReadOutcome {
    const own = this.txns[t].dirty.get(rowId);
    if (own !== undefined) return { rowId, value: own, dirty: false };
    for (const other of CLIENT_ORDER) {
      if (other === t) continue;
      const v = this.txns[other].dirty.get(rowId);
      if (v !== undefined) {
        return this.isolation === "read_uncommitted"
          ? { rowId, value: v, dirty: true }
          : { rowId, value: this.rows.get(rowId) ?? 0, dirty: false };
      }
    }
    return { rowId, value: this.rows.get(rowId) ?? 0, dirty: false };
  }

  private scanVisible(t: ClientId, lo: number, hi: number): number {
    let count = 0;
    for (const id of this.rows.keys()) {
      if (id >= lo && id <= hi) count += 1;
    }
    if (this.isolation === "read_uncommitted") {
      for (const other of CLIENT_ORDER) {
        if (other === t) continue;
        for (const id of this.txns[other].dirty.keys()) {
          if (id >= lo && id <= hi && !this.rows.has(id)) count += 1;
        }
      }
    }
    return count;
  }

  private strongRangeCovering(rowId: number, except: ClientId): RangeLock | null {
    return (
      this.rangeLocks.find(
        (r) => r.strong && r.txnId !== except && rowId >= r.lo && rowId <= r.hi,
      ) ?? null
    );
  }

  private detectAnomaliesFromStep(step: ConcurrencyStep): void {
    const t = step.txnId;
    if (step.read) {
      this.readHistory[t].push({ rowId: step.read.rowId, value: step.read.value });
      if (step.read.dirty) {
        this.anomalies.push({
          kind: "dirty",
          txnId: t,
          detail: `${t} read ${step.read.value} (uncommitted by another txn)`,
        });
        step.anomaly = step.anomaly ?? "dirty";
      }
      while (this.readChecked[t] < this.readHistory[t].length - 1) {
        const prev = this.readHistory[t][this.readChecked[t]];
        this.readChecked[t] += 1;
        const cur = this.readHistory[t][this.readChecked[t]];
        if (prev.rowId === cur.rowId && prev.value !== cur.value) {
          this.anomalies.push({
            kind: "non-repeatable",
            txnId: t,
            detail: `${t} read account ${cur.rowId} as ${prev.value} then ${cur.value}`,
          });
          step.anomaly = step.anomaly ?? "non-repeatable";
        }
      }
    }
    if (step.scan) {
      this.scanHistory[t].push(step.scan);
      while (this.scanChecked[t] < this.scanHistory[t].length - 1) {
        const prev = this.scanHistory[t][this.scanChecked[t]];
        this.scanChecked[t] += 1;
        const cur = this.scanHistory[t][this.scanChecked[t]];
        if (prev.lo === cur.lo && prev.hi === cur.hi && prev.count !== cur.count) {
          this.anomalies.push({
            kind: "phantom",
            txnId: t,
            detail: `${t} scanned id [${cur.lo}..${cur.hi}] as ${prev.count} rows then ${cur.count} rows`,
          });
          step.anomaly = step.anomaly ?? "phantom";
        }
      }
    }
  }

  private handleWait(
    t: ClientId,
    resourceId: string,
    label: string,
    mode: LockMode,
  ): "blocked" | "aborted" {
    this.markBlocked(t, resourceId, this.stepId);
    this.pushStep(t, "lock-wait", label, { lock: { resourceId, mode } });
    const cycle = this.detectCycle();
    if (!cycle) return "blocked";
    const victim = cycle[cycle.length - 1];
    this.pushStep(
      victim,
      "deadlock",
      `DEADLOCK — wait-for cycle ${cycle.join(" → ")} → ${cycle[0]}; aborting ${victim}`,
      { anomaly: "deadlock" },
    );
    const { locks, ranges } = this.releaseAll(victim);
    const dirtyCount = this.txns[victim].dirty.size;
    this.txns[victim].dirty.clear();
    this.txns[victim].waitingOn = null;
    this.txns[victim].status = "aborted";
    this.blockStart.delete(victim);
    this.pushStep(
      victim,
      "abort",
      `${victim} ABORTED as deadlock victim (${locks} lock${locks === 1 ? "" : "s"} released, ${dirtyCount} dirty write${dirtyCount === 1 ? "" : "s"} discarded${ranges.length ? ", range locks lifted" : ""})`,
      {},
    );
    this.anomalies.push({
      kind: "deadlock",
      txnId: victim,
      detail: `cycle ${cycle.join(" → ")} → ${cycle[0]}; ${victim} aborted`,
    });
    void mode;
    return victim === t ? "aborted" : "blocked";
  }

  private executeEvent(ev: SimEvent): "ok" | "blocked" | "aborted" {
    const t = ev.txnId;
    const it = this.txns[t];
    switch (ev.op) {
      case "begin": {
        this.pushStep(t, "begin", `${t} BEGIN (${isoName(it.isolation)})`, {});
        this.completeOp(t);
        return "ok";
      }
      case "select": {
        const rowId = ev.rowId ?? 1;
        if (it.isolation === "read_uncommitted") {
          const out = this.readVisible(t, rowId);
          const dirty = out.dirty;
          const step: ConcurrencyStep = {
            id: this.stepId,
            kind: "read",
            txnId: t,
            label: `${t} SELECT account[${rowId}] → ${out.value}${dirty ? " ⚠ uncommitted" : ""}`,
            state: this.snapshot(this.stepId),
            anomaly: dirty ? "dirty" : null,
            read: out,
            scan: null,
            lock: null,
          };
          this.steps.push(step);
          this.stepId += 1;
          this.detectAnomaliesFromStep(step);
          this.completeOp(t);
          return "ok";
        }
        const resId = RES_ROW(rowId);
        if (this.tryAcquire(t, resId, "S") === "blocked") {
          return this.handleWait(t, resId, `${t} parks on S ${resId}`, "S");
        }
        const out = this.readVisible(t, rowId);
        const short = it.isolation === "read_committed";
        const step: ConcurrencyStep = {
          id: this.stepId,
          kind: "read",
          txnId: t,
          label: `${t} SELECT account[${rowId}] → ${out.value}${short ? " (S released)" : " (S held)"}`,
          state: this.snapshot(this.stepId),
          anomaly: null,
          read: out,
          scan: null,
          lock: { resourceId: resId, mode: "S" },
        };
        this.steps.push(step);
        this.stepId += 1;
        this.detectAnomaliesFromStep(step);
        if (short) {
          this.grants = this.grants.filter((g) => !(g.txnId === t && g.resourceId === resId));
        }
        this.completeOp(t);
        return "ok";
      }
      case "select_range": {
        const lo = ev.lo ?? 1;
        const hi = ev.hi ?? 99;
        if (it.isolation === "read_uncommitted") {
          const count = this.scanVisible(t, lo, hi);
          const step: ConcurrencyStep = {
            id: this.stepId,
            kind: "scan",
            txnId: t,
            label: `${t} SELECT id IN [${lo}..${hi}] → ${count} rows (no lock)`,
            state: this.snapshot(this.stepId),
            anomaly: null,
            read: null,
            scan: { lo, hi, count },
            lock: null,
          };
          this.steps.push(step);
          this.stepId += 1;
          this.detectAnomaliesFromStep(step);
          this.completeOp(t);
          return "ok";
        }
        const resId = RES_RANGE(lo, hi);
        if (this.tryAcquire(t, resId, "S") === "blocked") {
          return this.handleWait(t, resId, `${t} parks on S ${resId}`, "S");
        }
        const strong = it.isolation === "serializable";
        if (strong && !this.rangeLocks.some((r) => r.txnId === t && r.lo === lo && r.hi === hi)) {
          this.rangeLocks.push({ lo, hi, txnId: t, strong: true });
        }
        const short = it.isolation === "read_committed";
        const count = this.scanVisible(t, lo, hi);
        const step: ConcurrencyStep = {
          id: this.stepId,
          kind: "scan",
          txnId: t,
          label: `${t} SELECT id IN [${lo}..${hi}] → ${count} rows${strong ? " + range lock" : short ? " (S released)" : " (S held)"}`,
          state: this.snapshot(this.stepId),
          anomaly: null,
          read: null,
          scan: { lo, hi, count },
          lock: { resourceId: resId, mode: "S" },
        };
        this.steps.push(step);
        this.stepId += 1;
        this.detectAnomaliesFromStep(step);
        if (short) {
          this.grants = this.grants.filter((g) => !(g.txnId === t && g.resourceId === resId));
        }
        this.completeOp(t);
        return "ok";
      }
      case "update": {
        const rowId = ev.rowId ?? 1;
        const resId = RES_ROW(rowId);
        const mine = this.grants.find((g) => g.resourceId === resId && g.txnId === t);
        const isUpgrade = !!mine && mine.mode === "S";
        if (this.tryAcquire(t, resId, "X") === "blocked") {
          return this.handleWait(t, resId, `${t} parks on X ${resId}${isUpgrade ? " (upgrade S→X)" : ""}`, "X");
        }
        const base = this.readVisible(t, rowId);
        const next = Math.max(0, base.value + (ev.delta ?? 0));
        it.dirty.set(rowId, next);
        const step: ConcurrencyStep = {
          id: this.stepId,
          kind: "write",
          txnId: t,
          label: `${t} UPDATE account[${rowId}] ${base.value} → ${next} (uncommitted)`,
          state: this.snapshot(this.stepId),
          anomaly: null,
          read: { rowId, value: base.value, dirty: false },
          scan: null,
          lock: { resourceId: resId, mode: "X" },
        };
        this.steps.push(step);
        this.stepId += 1;
        this.completeOp(t);
        return "ok";
      }
      case "insert": {
        const rowId = ev.rowId ?? 6;
        const value = ev.value ?? 700;
        const covering = this.strongRangeCovering(rowId, t);
        if (covering) {
          const resId = RES_RANGE(covering.lo, covering.hi);
          return this.handleWait(
            t,
            resId,
            `${t} INSERT account[${rowId}] parked by ${covering.txnId}’s range lock (gap locking)`,
            "X",
          );
        }
        const resId = RES_ROW(rowId);
        if (this.tryAcquire(t, resId, "X") === "blocked") {
          return this.handleWait(t, resId, `${t} parks on X ${resId}`, "X");
        }
        it.dirty.set(rowId, value);
        const step: ConcurrencyStep = {
          id: this.stepId,
          kind: "insert",
          txnId: t,
          label: `${t} INSERT account[${rowId}] = ${value} (uncommitted)`,
          state: this.snapshot(this.stepId),
          anomaly: null,
          read: null,
          scan: null,
          lock: { resourceId: resId, mode: "X" },
        };
        this.steps.push(step);
        this.stepId += 1;
        this.completeOp(t);
        return "ok";
      }
      case "commit": {
        for (const [rowId, value] of it.dirty) this.rows.set(rowId, value);
        const { locks } = this.releaseAll(t);
        it.dirty.clear();
        it.status = "committed";
        this.pushStep(
          t,
          "commit",
          `${t} COMMIT — ${locks} lock${locks === 1 ? "" : "s"} released${locks > 0 ? ", waiters woken" : ""}`,
          {},
        );
        this.completeOp(t);
        return "ok";
      }
      case "rollback": {
        const discard = it.dirty.size;
        const { locks } = this.releaseAll(t);
        it.dirty.clear();
        it.waitingOn = null;
        it.status = "aborted";
        this.pushStep(t, "rollback", `${t} ROLLBACK — ${locks} lock${locks === 1 ? "" : "s"} released, ${discard} dirty writes discarded`, {});
        this.completeOp(t);
        return "aborted";
      }
    }
  }
}

function cloneRows(rows: Map<number, number>): RowValue[] {
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, value]) => ({ id, value }));
}