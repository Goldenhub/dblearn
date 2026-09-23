import type { Challenge } from "../engine/challengeEngine";

/**
 * Phase 6 — challenge catalog. Five production incidents mapped to the
 * playground's five modules. Each challenge carries its own assertions,
 * teaching copy, and first-principles breakdown; solutions are documented
 * for the feedback drawer (they are never auto-applied — the learner has to
 * earn them, and the evaluator only ever shows before/after diffs).
 */

export const CHALLENGES: Challenge[] = [
  {
    id: "missing_index",
    title: "The Missing Index",
    category: "plan",
    difficulty: 2,
    story:
      "Your reporting API filters the 500k-row `events` table on `user_id`. Under peak traffic a single lookup takes ~800 ms against a 7,813-page sequential read.",
    issue: "The query plan shows a full Sequential Scan of `events` even though only a handful of rows match.",
    schema: [
      { name: "events", detail: "500,000 rows · id (PK), user_id, code" },
      { name: "index", detail: "B-Tree on events(user_id) — today: none" },
    ],
    goals: [
      "Return `id` + `code` for `user_id = 42`, ordered by `id`",
      "Replace the sequential scan with a B-Tree index seek (fewer than 10 page reads)",
      "Match the reference result set exactly",
    ],
    hints: [
      { id: "h1", text: "The B-Tree playground's math: one point lookup touches fewer than log₂₀₀₀₀ rows-worth of pages.", penalty: 10 },
      { id: "h2", text: "Toggle the index on to see the cost model switch from ¥7813 page reads to 4.", penalty: 10 },
    ],
    solution:
      "Add an index on `events(user_id)` and keep the plain filter query. The optimizer reads ~4 pages (3 B-Tree levels + 1 data page) instead of scanning all 7,813 pages.",
    firstPrinciples:
      "A sequential scan can't skip rows: it reads every 8 KiB page of the table. A B-Tree on the filter key turns a 7,813-page read into 3 index-level hops + 1 data page — proportional to log₂₅₆(N), not N. That is what the B-Tree Index lab proves visually.",
    assertions: [
      { kind: "MAX_DISK_READS", target: 10, message: "Lookup must read fewer than 10 pages" },
      { kind: "EXPECTED_NODE_TYPE", op: "index", message: "The dominant access must be a B-Tree index seek, not a sequential scan" },
      { kind: "RESULT_SET_MATCH", message: "Query output must match the reference result set" },
    ],
    defaultSubmission: {
      kind: "sql",
      sql: "SELECT id, code FROM events WHERE user_id = 42 ORDER BY id",
      indexColumn: null,
    },
    setupSql: [
      "CREATE OR REPLACE TABLE events AS SELECT range.i AS id, CAST((range.i * 7) % 1000 AS INTEGER) AS user_id, 'evt_' || CAST(range.i AS VARCHAR) AS code FROM range(500000)",
    ],
    referenceSql: "SELECT id, code FROM events WHERE user_id = 42 ORDER BY id",
    rowCounts: { events: 500_000 },
  },
  {
    id: "n_plus_one",
    title: "The N+1 Query Disaster",
    category: "plan",
    difficulty: 3,
    story:
      "An ORM loop calls one query per order row to fetch the customer name. With 10k `txns` that means 10,000 inner lookups over the 2k-row `users` table — 320,000 page reads.",
    issue: "A correlated scalar subquery inside the SELECT executes the inner scan once per outer row.",
    schema: [
      { name: "txns", detail: "10,000 rows · tx_id, user_id, amount" },
      { name: "users", detail: "2,000 rows · id, name" },
    ],
    goals: [
      "Return tx_id, amount and the customer name (first 3 rows by tx_id)",
      "Fetch the customer data in a single pass (fewer than 500 page reads)",
      "Match the reference result set exactly",
    ],
    hints: [
      { id: "h1", text: "Count how many times `users` is entered: once per row (N+1) vs once total.", penalty: 10 },
      { id: "h2", text: "A JOIN (or IN-list) reads each table exactly once — O(outer pages + inner pages).", penalty: 10 },
    ],
    solution:
      "Replace the correlated subquery with `FROM txns t JOIN users u ON u.id = t.user_id`. The engine scans `txns` once (157 pages) and `users` once (32 pages) — or ~160 pages if the customer lookup is indexed.",
    firstPrinciples:
      "N+1 reads are outer-rows × inner-pages: 10,000 × 32 = 320,000 page reads. A hash/merge JOIN streams both inputs once each: 157 + 32. The fix is proportional to the number of tables, not the number of rows.",
    assertions: [
      { kind: "MAX_DISK_READS", target: 500, message: "Fetch must read fewer than 500 pages" },
      { kind: "MAX_EXECUTION_TIME_MS", target: 50, message: "Estimated time must stay under 50 ms" },
      { kind: "RESULT_SET_MATCH", message: "Query output must match the reference result set" },
    ],
    defaultSubmission: {
      kind: "sql",
      sql: "SELECT t.tx_id, t.amount, (SELECT u.name FROM users u WHERE u.id = t.user_id) AS name FROM txns t ORDER BY t.tx_id LIMIT 3",
      indexColumn: null,
    },
    setupSql: [
      "CREATE OR REPLACE TABLE users AS SELECT range.i AS id, 'u' || CAST(range.i AS VARCHAR) AS name FROM range(2000)",
      "CREATE OR REPLACE TABLE txns AS SELECT range.i AS tx_id, CAST((range.i * 13) % 2000 AS INTEGER) AS user_id, range.i * 10 AS amount FROM range(10000)",
    ],
    referenceSql:
      "SELECT t.tx_id, t.amount, u.name FROM txns t JOIN users u ON u.id = t.user_id ORDER BY t.tx_id LIMIT 3",
    rowCounts: { users: 2_000, txns: 10_000 },
  },
  {
    id: "buffer_thrash",
    title: "The Buffer Pool Thrash",
    category: "buffer",
    difficulty: 1,
    story:
      "An OLTP workload cycles through hot pages faster than the tiny 4-frame buffer pool can keep them resident. Every access is a disk fetch — 78% cache misses.",
    issue: "The pool is too small to hold the working set, and every eviction ends in a disk read.",
    schema: [
      { name: "memory", detail: "buffer pool · 4–16 frames × 8 KiB" },
      { name: "disk", detail: "64-page heap · reads hit a page fault when absent" },
    ],
    goals: [
      "Raise the cache hit ratio (fewer than 120 disk reads)",
      "Keep estimated latency under 20 ms",
      "Prefer LRU for slightly better hit rate over Clock sweep",
    ],
    hints: [
      { id: "h1", text: "Hot pages repeat ~75% of the time; if the pool can hold the hot set, they stop faulting.", penalty: 5 },
      { id: "h2", text: "Watch the diff panel: every missed frame count drops disk reads by ~10%+.", penalty: 5 },
    ],
    solution:
      "Grow the pool to 16 frames (Baseline 225 reads → 93) and keep LRU. Clock sweep needs one more frame to reach the same hit rate because a referenced page gets a second chance before eviction.",
    firstPrinciples:
      "A cache only pays when the working set fits. At 4 frames the hot set (8 pages) thrashes — every access evicts something it needs again. Doubling the pool to 16 pages turns ~78% of accesses into cache hits. LRU evicts the least-recently-used page; Clock approximates it with a reference bit but can keep a hot page alive one extra lap.",
    assertions: [
      { kind: "MAX_DISK_READS", target: 120, message: "Disk reads must drop below 120" },
      { kind: "MAX_EXECUTION_TIME_MS", target: 20, message: "Estimated I/O latency must stay under 20 ms" },
    ],
    defaultSubmission: { kind: "buffer", frameCount: 4, policy: "lru" },
  },
  {
    id: "dirty_read",
    title: "The Dirty Read Bug",
    category: "concurrency",
    difficulty: 1,
    story:
      "A support agent runs a balance check while a payment transaction is mid-flight. READ UNCOMMITTED leaks the transient balance (400, after a −100 move) before it ever commits — the payment then rolls back and the agent just quoted a transaction that never happened.",
    issue: "READ UNCOMMITTED lets a reader observe another transaction's uncommitted write.",
    schema: [
      { name: "accounts", detail: "5 rows · id 1..5, balance 500" },
      { name: "txn A", detail: "writes −100 to row 1, not yet committed" },
      { name: "txn B", detail: "read-only, must not see the transient −100" },
    ],
    goals: [
      "Keep txn B's read isolated from txn A's uncommitted write",
      "Pick the isolation level that blocks dirty reads with the least overhead",
    ],
    hints: [
      { id: "h1", text: "Only READ UNCOMMITTED skips shared locks entirely — that is what allows the dirty read.", penalty: 5 },
      { id: "h2", text: "The simplest fix: READ COMMITTED. It takes a short shared lock and releases it at once, so later transactions re-read.", penalty: 5 },
    ],
    solution:
      "Switch the session to READ COMMITTED (or higher). The reader's shared lock now conflicts with the writer's exclusive lock, so it reads 400 only after the payment commits — never the transient state.",
    firstPrinciples:
      "Dirty reads are the cost of skipping shared locks. READ UNCOMMITTED takes no read lock, so the reader can watch another transaction's uncommitted write. READ COMMITTED takes the shared lock on each read and releases it at once — short guarding and no dirty data; uncommitted values become the privilege of the writer alone.",
    assertions: [
      { kind: "NO_DIRTY_READS", message: "No reader may observe an uncommitted write" },
    ],
    defaultSubmission: { kind: "isolation", isolation: "read_uncommitted" },
  },
  {
    id: "deadlock_resolution",
    title: "The Deadlock Resolution",
    category: "concurrency",
    difficulty: 2,
    story:
      "Two checkout transactions update the same two account rows in opposite orders. Txn A holds row 1 and waits for row 2; Txn B holds row 2 and waits for row 1. Nobody finishes.",
    issue: "Global inconsistency in lock acquisition order creates a Wait-For cycle.",
    schema: [
      { name: "accounts", detail: "3 rows · both txns touch rows 1 and 2" },
      { name: "txn A", detail: "locks row 1 → then row 2" },
      { name: "txn B", detail: "locks row 2 → then row 1 (opposite order)" },
    ],
    goals: [
      "Ensure no deadlock forms under the shape of this workload",
      "Keep both transactions committing (+10 to each target row)",
      "Use a consistent global lock order across all transactions",
    ],
    hints: [
      { id: "h1", text: "A cycle in the Wait-For graph is a deadlock; break it by making the ordering globally consistent.", penalty: 10 },
      { id: "h2", text: "If every transaction locks rows in ascending id order, one of them always gets the first lock.", penalty: 10 },
    ],
    solution:
      "Adopt a single global lock ordering — both transactions acquire rows in ascending id order (or both descending). The cycle cannot form because only one transaction can ever be first on the shared lowest-numbered row.",
    firstPrinciples:
      "Deadlocks are Wait-For graph cycles. Two resources, two directions = a loop. Imposing one global order (asc or desc) turns the acquires into a chain: the first lock is arbitration, and the second is guaranteed available. Strict 2PL keeps the writer's lock to COMMIT, so the ordering has to be decided before the locks are taken.",
    assertions: [
      { kind: "NO_DEADLOCKS", message: "The Wait-For graph must stay acyclic" },
    ],
    defaultSubmission: { kind: "locks", ordering: "mixed" },
  },
];

export function challengeFor(id: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

export const CATEGORY_LABEL: Record<Challenge["category"], string> = {
  plan: "Query Plan",
  btree: "B-Tree Index",
  concurrency: "Isolation & Locks",
  buffer: "Buffer Pool",
};