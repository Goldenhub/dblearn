# dblearn — Database Engine Learning Playground

## Product

A zero-latency, browser-native web app that teaches database internals visually: write SQL, adjust mock table/index sizes, and immediately see query plans, cost graphs, B-Tree traversals, and buffer-pool behavior. Everything runs 100% in the browser — **no backend server, no live database**.

Note: this supersedes an earlier design (a backend "Secure Execution Proxy" with `pg`/`mysql2` connection strings). Do not resurrect that architecture; all query execution is client-side.

## Stack

- Next.js (App Router), React, Tailwind CSS, Shadcn UI
- DuckDB-Wasm (`@duckdb/duckdb-wasm@1.32.0`) in a Web Worker — the query engine
- React Flow (`@xyflow/react`) for query-plan DAGs
- Monaco Editor (`@monaco-editor/react` + bundled `monaco-editor`) — offline, no CDN

## Commands

- `npm run dev` / `npm run build` / `npm run start` — each first runs `scripts/copy-duckdb-assets.mjs`, which copies the DuckDB-wasm + inner-worker files into `public/db` (gitignored). Keep the file list in that script in sync with the `@duckdb/duckdb-wasm` version.
- `npm run lint` — ESLint, must stay clean. `public/db/**` and `.next/**` are ignored.
- `npm run check:e2e` — headless-Chrome smoke test (`scripts/e2e.mjs`). Requires a running server on :3000 and a Chromium binary (`npx playwright-core install chromium`, or `PLAYWRIGHT_CHROMIUM=<path>`).

## Query-plan gotchas (verified against 1.32.0)

- Use **`EXPLAIN (ANALYZE, FORMAT JSON)`** — the unparenthesized `EXPLAIN ANALYZE FORMAT JSON` crashes the engine (Emscripten `_setThrew is not defined`) in DuckDB-Wasm 1.32.
- The JSON lands in the single `explain_value` column. Plan nodes carry `operator_name`, `operator_type`, `extra_info`, `operator_timing`, `operator_rows_scanned`, `operator_cardinality`, and `children`.
- `EXPLAIN (ANALYZE, FORMAT JSON)` cannot be verified in Node — the Node build hits the same Emscripten bug. Verify SQL shape changes in a real browser (e.g. via `scripts/e2e.mjs`).

## Worker pipeline (Phase 1, done)

- `src/lib/duckdb/protocol.ts` — message types shared by both sides (keep import-free).
- `src/lib/duckdb/db-worker.ts` — Web Worker that boots `AsyncDuckDB` (mvp bundle: no Cross-Origin Isolation/SharedArrayBuffer needed), server `init` and `explain` messages, auto-seeds demo tables (`orders` 200 rows, `customers` 20 rows).
- `src/lib/duckdb/client.ts` — main-thread bridge; pairs responses to requests by id; `initEngine()` warms + seeds, `explainSql()` returns a parsed `DuckDBExplainResult`.
- Engine assets are plain URLs (`/db/duckdb-mvp.wasm`) copied to `public/` — **do not** try webpack/wasm import tricks; production builds run under Turbopack.
- The app is now **routed** (Next.js App Router — see Phase 8): the lab lives in `src/components/plan/PlanLab.tsx` (`"use client"`; engine init + auto-run + graph), and Monaco must be loaded via `next/dynamic` with `ssr: false` (SqlEditor is browser-only). `src/app/page.tsx` is only a server `redirect("/learn")`.
- Monaco worker specifier is `monaco-editor/editor/editor.worker` (the package's exports map rejects the `esm/vs/...` path).

**Phase 2: Query Plan AST Parser & Interactive React Flow Node Graph Generator**.

### Phase 2 Core Deliverables

1. **JSON Execution Plan Parser (`lib/parser/planMapper.ts`):**
   - Take raw `EXPLAIN (ANALYZE, FORMAT JSON)` output from DuckDB-Wasm / Postgres.
   - Recursively parse the plan tree into structured React Flow `nodes` and `edges`.
   - Compute metrics per node:
     - **Cost Heatmap:** Calculate `operator_cost` or `timing_ms` relative to total query time (e.g., green for <10%, yellow for 10-40%, red for >40%).
     - **Data Flow Scale:** Calculate stroke width for edges based on `cardinality` / `actual_rows`.
     - **Bottleneck Warnings:** Tag nodes with warnings (e.g., `SEQ_SCAN_ON_LARGE_TABLE`, `DISK_SPILL`, `FILTER_AFTER_SCAN`).

2. **Custom React Flow Graph Components (`components/nodes/`):**
   - Create custom node UI components with clean Shadcn UI styling:
     - **`ScanNode`:** Displays table name, scan type (Seq Scan vs. Index Scan), filter predicates, and rows processed.
     - **`JoinNode`:** Displays join type (Hash, Nested Loop, Merge), build vs. probe sides, and memory usage.
     - **`AggregateSortNode`:** Displays sort keys, memory vs. disk spill stats, and grouping columns.
   - Include visual badges for cost percentage and warning icons.

3. **Interactive Graph Controls & Detail Inspector (`components/PlanInspector.tsx`):**
   - Clicking any node opens a detail side drawer showing raw JSON attributes, execution timing breakdown, and first-principles DB tips (e.g., _“Why is a Hash Join used here instead of Nested Loop?”_).

---

### Implementation Instructions

Provide complete, fully-typed TypeScript code for:

1. `planMapper.ts` (JSON tree -> React Flow nodes/edges layout generator).
2. `CustomPlanNode.tsx` (a unified, interactive React Flow node supporting Scans, Joins, and Aggregates with Tailwind CSS).
3. Updated main graph component integrating dagre or ELK for automatic top-to-bottom DAG layout.

**Phase 2 is implemented.** Delivered files and verified facts:

- `src/lib/parser/planMapper.ts` — `buildPlanModel(plan)` walks the `EXPLAIN (ANALYZE, FORMAT JSON)` tree into React Flow nodes/edges; computes per-node `PlanNodeMetrics` (timingMs, share-of-total %, heat low/medium/high at 10%/40% thresholds, rowsIn/rowsOut, warnings) and `edgeStrokeWidth` (1-7, keyed to max edge cardinality).
- `src/lib/parser/planTips.ts` — first-principles DB tips per operator category + `tipForWarning()` for warning codes (`SEQ_SCAN_ON_LARGE_TABLE`, `FILTER_AFTER_SCAN`, `CROSS_JOIN`, `HIGH_TIMING_PCT`, `DISK_SPILL`).
- `src/components/nodes/CustomPlanNode.tsx` — unified node (all operator categories via `categorizeOperator`), heat-colored border + cost badge, category dot, warnings row; exports `WARNING_LABELS`/`HEAT_*`.
- `src/components/PlanInspector.tsx` — side drawer opened from node click: metrics grid, warnings + tips, operator detail, raw JSON.
- `src/components/plan-graph.tsx` — dagre (`@dagrejs/dagre@^1.1.5`, `rankdir: TB`) layout, edges stroked by cardinality, `fitView`, Escape/selection logic.

Verified against real 1.32.0 plans: `operator_timing` is already **ms** (a number, no `*1000`); `operator_rows_scanned` = rows in, `operator_cardinality` = rows out; root EXPLAIN_ANALYZE has timing 0 and carries top-level `latency`/`cpu_time`/`total_bytes_read`. Node ids are `p-<n>` in plan order. dagre layout is computed in a client `useMemo` then React Flow renders it; if node positions ever appear all-stacked at one point, suspect a stale `.next` build (dagre itself returns sane coordinates).

**Phase 3: Interactive B-Tree Index & Search Visualizer Canvas**.

### Objective

Build a stand-alone, highly visual, and interactive B-Tree node canvas component in React. Users can insert/delete keys, adjust degree order ($M$), and run `LOOKUP` queries to watch $O(\log N)$ tree traversals, node splits, and page pointer hops animated in real time.

---

### Core Deliverables

1. **B-Tree Data Structure Engine (`lib/engine/btree.ts`):**
   - Implement a pure TypeScript B-Tree class supporting `insert(key, value)`, `delete(key)`, and `search(key)`.
   - Support dynamic node degree configuration (e.g., $Order = 3$ for 2-3 Trees up to $Order = 5$).
   - Record step-by-step execution snapshots during operations so the frontend can step through or animate tree operations (e.g., node traversal, key comparison, node split, root elevation).

2. **Interactive B-Tree Canvas Component (`components/btree/BTreeVisualizer.tsx`):**
   - Render the tree structure cleanly on an HTML5 Canvas or SVG container.
   - Smoothly animate node splits and key redistribution when a node exceeds max capacity ($2t - 1$).
   - Highlight active lookup paths in real-time (color-coded pointer hops from Root $\rightarrow$ Intermediate Nodes $\rightarrow$ Leaf Nodes).
   - Display pointer hop count vs. sequential scan step count side-by-side ($O(\log N)$ vs $O(N)$) to prove indexing performance gains.

3. **Control Bar & Interactive Playground UI (`components/btree/BTreeControls.tsx`):**
   - **Controls:** Inputs for inserting single keys, batch inserting random arrays, deleting keys, and searching keys.
   - **Playback Controls:** Play, Pause, Step Forward, Step Backward, and Speed Slider (0.5x to 4x) for step-by-step traversal inspection.
   - **Educational Overhead Callout:** Display page fill factor, memory overhead, and node count stats.

---

### Implementation Instructions

Provide complete, fully-typed TypeScript code for:

1. `btree.ts` (Complete B-Tree engine with step recording for visual playback).
2. `BTreeCanvas.tsx` (Interactive SVG/Canvas renderer with step-by-step traversal highlighting).
3. `BTreePlayground.tsx` (Parent wrapper component combining controls, canvas, and performance metrics panel).

**Phase 3 is implemented.** Delivered files and verified facts:

- `src/lib/engine/btree.ts` — pure-TS `BTree` engine using the **CLRS minimum degree `t`** convention (the prompt's `2t − 1` max-capacity rule is only exact there): pages hold `t − 1`…`2t − 1` keys, `Order` = max children = `2t`, exposed as `t ∈ {2, 3}` in the UI. `insert(key, value?)`, `delete(key)`, `search(key)` each return `{ steps, result }`; every `BTreeStep` embeds a full `BTreeSnapshot` (node id/keys/leaf/childIds, rootId, config) so playback is pure index math — no need to re-run the tree. Steps carry a `kind` (`start`, `compare`, `descend`, `insert`, `split`, `overflow`, `promote`, `root-up`, `match`, `found`, `not-found`, `duplicate`, `remove`, `merge`, `borrow`, `root-down`), a human label, `pathIds` (pointer path node ids), and `active` (`nodeId` + `keyIndex`). Export helpers `snapshotStats()` (keyCount, nodeCount, height, avg/min/max fill %, est. byte size) and `insertRandomKeys(tree, count, min?, max?)` which records one combined step-history for the whole batch.
- `src/components/btree/BTreeCanvas.tsx` — SVG renderer (default export `BTreeCanvas`, plus `BTreeVisualizer` alias per the spec). Recursive layout makes every page a key-chip row with blocker edges to children; animated via CSS `transform` transition on each node group so splits/merges slide smoothly. Lookup walks paint the pointer path + compared key amber; mutation steps tint the touched page emerald (grow/split), rose (overflow/remove), or sky (merge/borrow) via exported `stepAccent(kind)`.
- `src/components/btree/BTreeControls.tsx` — Insert (single), Random batch (≤60), Delete, Lookup, degree selector `t ∈ {2,3}`, Reset, and the playback transport: ⏮ ◀ ▶/⏸ ▶ ⏭ + 0.5×–4× speed slider + `step x/N` readout.
- `src/components/btree/BTreePlayground.tsx` — parent wrapper owning the engine + step history + playback timer (620ms / speed, 0.5× at 1240ms, 4× at 155ms); keyboard Space/←/→ navigation (ignored while typing in inputs); updates snapshots live as it steps. Right rail shows the Index-vs-Sequential proof bars (real hop count vs `seqSteps`), page-fill/overhead stats, and a first-principles callout (one page = one disk read; 2t−1 split keeps height O(logN); fill factor = real memory).
- `src/app/page.tsx` — header view toggle **Query Plan | B-Tree Index** (`"plan" | "btree"` state); B-Tree mode hides the SQL pane/Run button and renders `BTreePlayground` full-width. *(superseded: now `/plan` and `/btree` routes — Phase 8)*
- Verified in headless Chromium: insert/random-fill/lookup produce real snapshots (e.g. 21 keys → 12 pages, height 2, avg fill 58%, 3 hops vs 21 sequential steps), transport steps 0→2→1 change the rendered tree, plan tab still runs after tab switching, zero console errors. Engine property-tested in Node (sequential/hooks + 600-op seeded interleaves, t=2 & t=3).
- Two engine bugs the property tests caught (keep the tests if re-verifying): duplicate-insert guard must check internal divider keys during descent, not just leaf keys (promote could recurse into an overflowing child); delete-predecessor must use the **rightmost** descendant of the left child, not `leftmost`.

**Phase 4: Storage Engine & Buffer Pool Simulator**.

### Objective

Build a visual, first-principles simulation of database page management and disk I/O. Users can execute read/write operations and watch how fixed-size 8KB memory pages interact with the disk storage engine, dirty page tracking, Write-Ahead Logging (WAL), and cache eviction algorithms (LRU and Clock Sweep).

---

### Core Deliverables

1. **Buffer Pool & Page Management Engine (`lib/engine/bufferPool.ts`):**
   - Model fixed-size memory slots (Frame Array) alongside a persistent Disk Storage representation (Page Blocks).
   - Track key page states: `Page ID`, `Is Dirty`, `Pin Count`, `LSN (Log Sequence Number)`, and `Access History`.
   - Implement eviction policies:
     - **LRU (Least Recently Used):** Queue/Stack tracking eviction order.
     - **Clock Sweep (Second Chance Algorithm):** Clock hand pointer checking usage bits.
   - Record step-by-step state transitions during `READ_PAGE` and `WRITE_PAGE` operations for visual animation playback.

2. **Buffer Pool Visual Grid (`components/storage/BufferPoolGrid.tsx`):**
   - Render memory frames as a grid of interactive cards displaying Page ID, Pin Count, Dirty status badge, and usage bit.
   - Render the Disk Block storage area below memory frames to visually illustrate cache hits vs. disk I/O fetches.
   - Animate dirty page flushes down to disk blocks when eviction occurs or when an explicit `CHECKPOINT` is triggered.

3. **Write-Ahead Logging (WAL) Stream Component (`components/storage/WALStream.tsx`):**
   - Visual log append timeline demonstrating the Write-Ahead Logging rule: dirty pages cannot flush to disk until the corresponding log entry is committed to the WAL.

4. **Buffer Pool Playground Wrapper (`components/storage/StoragePlayground.tsx`):**
   - **Controls:** Sliders for Buffer Pool Size (e.g., 4 to 16 frames), eviction policy toggle (LRU vs. Clock Sweep), random read/write triggers, and a `CHECKPOINT` button.
   - **Metrics Panel:** Real-time calculation of **Cache Hit Ratio (%)**, **Disk Reads Count**, **Disk Writes Count**, and **Dirty Page %**.

---

### Implementation Instructions

Provide complete, fully-typed TypeScript code for:

1. `bufferPool.ts` (Core simulation engine supporting LRU / Clock Sweep and step snapshot tracking).
2. `BufferPoolGrid.tsx` (Interactive visual grid showing memory frames, pin counts, dirty state, and disk block synchronization).
3. `StoragePlayground.tsx` (Parent control panel integrating parameter sliders, execution triggers, WAL stream, and live cache hit metrics).

**Phase 5: Concurrency, Locking & Isolation Level Playground**.

### Objective

Build a multi-client interactive simulation that demonstrates how database isolation levels manage concurrent transactions, lock acquisition (Shared vs. Exclusive), lock queues, and concurrency anomalies (Dirty Reads, Non-Repeatable Reads, Phantom Reads, and Deadlocks).

---

### Core Deliverables

1. **Transaction & Lock Engine (`lib/engine/concurrency.ts`):**
   - Model multi-client connection threads (`Client A`, `Client B`, `Client C`).
   - Implement Two-Phase Locking (2PL) with Shared (S) and Exclusive (X) row/table locks.
   - Implement isolation levels:
     - **Read Uncommitted:** Allows dirty reads; ignores shared read locks.
     - **Read Committed:** Takes shared locks during read and releases immediately; avoids dirty reads.
     - **Repeatable Read:** Holds shared locks until transaction `COMMIT`/`ROLLBACK`; avoids non-repeatable reads.
     - **Serializable:** Implements strict range/predicate locking to prevent phantom reads.
   - Support deadlock detection (Wait-For Graph traversal) and automatic transaction rollback.

2. **Multi-Thread Timeline Visualizer (`components/concurrency/TimelineGrid.tsx`):**
   - Dual/Triple lane timeline view illustrating parallel transaction steps side-by-side (`BEGIN`, `SELECT`, `UPDATE`, `COMMIT`, `ROLLBACK`).
   - Visual indicators showing when a thread blocks waiting for a lock held by another client.

3. **Lock Table & Lock Queue Monitor (`components/concurrency/LockMonitor.tsx`):**
   - Real-time table displaying current granted locks (Resource ID, Lock Mode, Owner Txn) and waiting queues.
   - Interactive Wait-For Graph showing cycle loops when deadlocks occur.

4. **Concurrency Playground Dashboard (`components/concurrency/ConcurrencyPlayground.tsx`):**
   - **Pre-set Anomaly Scenarios:** Single-click scenario loaders:
     - _Dirty Read scenario_ (Read Uncommitted vs. Read Committed).
     - _Lost Update / Non-Repeatable Read scenario_.
     - _Phantom Read scenario_.
     - _Deadlock scenario_ (Txn 1 locks Row A then requests Row B; Txn 2 locks Row B then requests Row A).
   - **Isolation Level Selector:** Dropdown to switch isolation levels mid-execution and watch how anomalies disappear or block.

---

### Implementation Instructions

Provide complete, fully-typed TypeScript code for:

1. `concurrency.ts` (Multi-client transaction manager with 2PL lock manager and Wait-For deadlock detection).
2. `TimelineGrid.tsx` (Interactive execution timeline component showing parallel client lanes, lock waits, and committed state changes).
3. `ConcurrencyPlayground.tsx` (Parent dashboard integrating scenario presets, isolation level toggles, lock monitors, and step-by-step transaction execution controls).

**Phase 5 is implemented.** Delivered files and verified facts:

- `src/lib/engine/concurrency.ts` — pure-TS `ConcurrencySim` over a single `accounts` table (rows `1..5 = 500`), clients A/B/C. Strict 2PL: every write lock (Exclusive) is held to COMMIT on every isolation level; Shared lock lifetime encodes isolation — `read_uncommitted` SELECT takes **no** lock (dirty reads), `read_committed` releases S immediately, `repeatable_read` holds S to COMMIT, `serializable` holds S plus a **strong range/predicate lock** (`rangeLocks[lo..hi].strong`) whose matching INSERTs block (gap locking).
- A scenario is a **global ordered script** of `SimEvent`s; `run()` scans the script each tick and executes the next runnable txn. Blocked events re-park in place and retry once their hold frees; blocked txns are redispatched via `unpark(resourceId)` after every release/abort. `tryAcquire` is idempotent + FIFO head-of-resource `drain`; S→X upgrades replace the caller's own S grant and queue at the tail. Deadlock = Wait-For Graph DFS; the victim is `cycle[cycle.length - 1]` (the requester that closed the loop) — its dirty writes are discarded, its step trace aborts.
- Every `ConcurrencyStep` (id, kind, txnId, label, anomaly, read/scan/lock payload) embeds a full `ConcurrencyState` snapshot (committed rows, dirty values with owner, granted locks, wait queue, range locks, waitFor edges, per-txn status) — UI is pure replay, same pattern as the B-Tree. `run()` returns `{ steps, summary }`; `summary.anomalies` (`dirty` | `non-repeatable` | `phantom` | `deadlock` with detail) and `summary.waitSpans` (closed when the waiter finally runs). `detectAnomaliesFromStep` statmps the anomaly onto the triggering step as well.
- Reader semantics: `readVisible` = own dirty first (read-your-writes), else RU hands out another txn's dirty value (flags `dirty`), all other levels read committed; `scanVisible` additionally counts other txns' uncommitted INSERTs at RU.
- 4 preset scenarios in `SCENARIOS` (each with `recommended` isolation): `dirty_read` (A writes 400 uncommitted; RU shows dirty 400, RC parks B's Shared request → reads 400 only after A commits), `non_repeatable` (B reads 500→600 under RC; RR parks A's write so B sees 500,500), `phantom` (B scans 1..99, A inserts row 6 + commits, B rescans 5→6 under RR; SERIALIZABLE parks A's insert behind B's strong range so B sees 5,5), `deadlock` (A→row1, B→row2, then each requests the other's row: cycle → B aborted, A's writes commit, `row1=row2=510`). Helpers: `scenarioFor`, `isolationLabel`, `isolationSummary`, `DEFAULT_ROWS`.
- `src/components/concurrency/TimelineGrid.tsx` — per-client horizontal lanes (A sky / B violet / C emerald), x = step index; chips colored by `kind` (begin/read/scan/write/insert/commit/rollback/abort/lock-wait/deadlock), amber dashed wait spans drawn from `summary.waitSpans`, ⚠ ring on anomaly steps, `title` tooltips carry the engine's full labels.
- `src/components/concurrency/LockMonitor.tsx` — "Holds & Wait Queue" (resource → granted `S·A`/`X·B` chips + dashed `wait` entries) and a Wait-For Graph SVG (amber dashed edges for plain waits, rose solid for cycles); the cycle's nodes glow and a `⚡ CYCLE: X → Y → X` caption names the members.
- `src/components/concurrency/ConcurrencyPlayground.tsx` — scenario cards, isolation `<select>` (re-runs the identical script under new rules), transport ⏮/Play/Step/|◀ + 0.5×–4× speed + step `x/N` readout, keyboard Space/←/→/Home/End (ignored while typing), live `accounts` table with rose dirty-value overlays, "Anomalies detected" badges (+`pending` count), and a strict-2PL first-principles callout.
- `src/app/page.tsx` — header view toggle is now **Query Plan | B-Tree Index | Isolation** (`"plan" | "btree" | "concurrency"`). *(superseded: now `/plan`, `/btree`, `/isolation` routes — Phase 8)*
- Verified: Node property tests (temp, deleted) assert every scenario under all 4 isolations — dirty @RU-only, non-repeatable @RU+RC-only, phantom @RU+RC+RR-only, deadlock → B aborted + A's `510/510` commit, no runaway scripts, sane rows/spans (the `phantom` script runs `A.insert; A.commit` before B's second scan so the dirty/committed row lands before the re-read). Headless-Chromium probe: cards render, RU shows the dirty ⚠, switching to RC re-runs and parks B instead, deadlock step glows the cycle and aborts B, zero console errors. `lint`, `build`, and `check:e2e` all green.

**Phase 4 (Storage Engine & Buffer Pool Simulator) is specified in this file but NOT implemented** — the prompt at `### Phase 4` above is the unimplemented spec; do not claim it is delivered.

**Phase 6: Guided Challenge Scenarios & Gamified Learning System**.

### Objective

Combine all interactive modules into a structured, scenario-driven learning platform (inspired by interactive platforms like Execute Program or ByteByteGo). Users face realistic "broken production database" challenges—such as slow queries, high buffer miss rates, ORM N+1 problems, and transaction deadlocks—and must tweak SQL queries, add optimal indexes, adjust isolation levels, or reconfigure buffer pools to pass automated test assertions.

---

### Core Deliverables

1. **Challenge Engine & Evaluator (`lib/engine/challengeEngine.ts`):**
   - Schema and type definitions for challenges (`Challenge`, `Assertion`, `Hint`, `Solution`).
   - Assertion evaluation runner that executes submitted queries or configuration settings against target performance metrics:
     - `MAX_EXECUTION_TIME_MS`
     - `MAX_DISK_READS`
     - `EXPECTED_NODE_TYPE` (e.g., verifying an `Index Scan` replaced a `Seq Scan`)
     - `NO_DEADLOCKS`
     - `RESULT_SET_MATCH` (verifying correctness of query output).
   - Scoring system tracking step count, execution efficiency score, and hint penalties.

2. **Interactive Challenge Workspace UI (`components/challenge/ChallengeWorkspace.tsx`):**
   - Split-pane interface:
     - **Left Pane:** Scenario story, production issue description (e.g., _"API endpoint timing out under peak traffic"_), schema ER diagram, and goal criteria checklist.
     - **Center Pane:** Interactive SQL Editor / Control panel.
     - **Right Pane:** Live query execution visualizer (swapping dynamically between Plan DAG, B-Tree, Buffer Pool, or Concurrency monitor based on challenge category).
   - **Feedback Drawer:** Real-time success banner, performance diff comparison (Before vs. After metrics), and first-principles breakdown of _why_ the fix worked.

3. **Curriculum Registry & Scenario Catalog (`lib/challenges/catalog.ts`):**
   - Pre-built suite of production scenarios:
     1. _The Missing Index:_ Transform a 500k-row Sequential Scan into a logarithmic B-Tree Index Scan.
     2. _The N+1 Query Disaster:_ Optimize multiple fragmented query loops into an efficient `JOIN` or `IN` predicate with proper index coverage.
     3. _The Dirty Read Bug:_ Fix a financial ledger race condition by adjusting isolation levels from Read Uncommitted to Read Committed.
     4. _The Buffer Pool Thrash:_ Optimize query page fetches to fit within fixed buffer cache capacity and prevent disk thrashing.
     5. _The Deadlock Resolution:_ Re-order lock acquisition sequences in concurrent transactions to eliminate Wait-For graph cycles.

4. **Progress & Accomplishment State (`lib/store/useProgressStore.ts`):**
   - Client-side persistent state (Zustand / LocalStorage) tracking completed challenges, score stars, unlockable modules, and completion badges.

---

### Implementation Instructions

Provide complete, fully-typed TypeScript code for:

1. `challengeEngine.ts` (Challenge assertion evaluator and performance metric comparison logic).
2. `catalog.ts` (Pre-configured challenge definitions covering indexing, locking, and query tuning).
3. `ChallengeWorkspace.tsx` (Complete workspace layout uniting problem requirements, interactive editor, execution visualizers, and test validation feedback).

---

### Phase 6 delivered (curated into a Learn-first curriculum)

The user redirected Phase 6 from "5 challenge scenarios" into a **lesson platform with tasks that teaches beginners database engineering**; the 5 challenges became capstones. Facts that must stay true:

- **Learn is the default landing view** (`/` redirects to `/learn`). Header tabs are real routes (Phase 8): `Learn | Query Plan | B-Tree Index | Isolation | Challenges` → `/learn | /plan | /btree | /isolation | /challenges`.
- **The curriculum is a Mongeesy-style single progressive track: 5 units × 60 lessons** (55 content + 5 capstones: foundations 9, storage 11, indexes 11, execution 13, transactions 11), a dedicated `foundations` unit first (what a database is, memory-vs-disk latency gap, how reads work, how writes work, pages as I/O unit) then storage / indexes / query-execution / transactions. `src/lib/lessons/curriculum.ts` exports `UNITS`, `lessonFor`, `unitFor`, and `COURSE_LESSONS` (global lesson order — LessonView's next/prev walks it, crossing unit boundaries). `LessonBlock` = `prose | callout | task | capstone`; a `capstone` block carries `challengeId` and is complete when the challenge's record exists. Helpers: `unitFor`, `lessonFor(id)`, `COURSE_LESSONS`.
- **Task kinds in `taskEngine.ts`: `number | btree | isolation | buffer | plan-choice | sql`.** `src/lib/lessons/queryAnalyzer.ts` is a pure-TS static SQL analyzer (never executes DuckDB): `analyzeQuery(sql, catalog)` returns the tables touched, per-table access mode `index|seq`, page reads/writes (8 KiB/128 B/0.1 ms closed-form model reused from challengeEngine), join pairs, correlated-subquery detection, warnings (`SEQUENTIAL_SCAN_ON_LARGE_TABLE`, `FILTER_MISSING_INDEX`, `UNFILTERED_DELETE/UPDATE`, `N_PLUS_ONE`, `LIKE_LEADING_WILDCARD`, `EXPRESSION_ON_INDEXED_COLUMN`, `SELECT_STAR_ON_LARGE_TABLE`, `UNKNOWN_STATEMENT`), and a plain-English summary. Bare filters like `WHERE user_id = 42` are attributed to the sole table in scope; the optional alias group rejects SQL keywords so `FROM orders o` doesn't alias-match `WHERE`; an indexed column wrapped in a function/cast/arithmetic (`expressionWrappedColumns`) forces `mode:"seq"` and flags `EXPRESSION_ON_INDEXED_COLUMN`; the `SELECT *` detector is `/\bselect\s+(?:\*|[a-z_][a-z0-9_]*\.\*)(?:\s|$)/i` (lookahead required — `\b` after `*` never matches). `curriculum.ts` exports `LESSON_SQL_CATALOG` (customers 20k indexed `[id]`; orders 200k indexed `[order_id, customer_id]`; events 500k indexed `[id]` — **user_id intentionally NOT indexed** so learners watch a 7,813-page scan; products 5k indexed `[id, sku]` with unindexed `name`; payments 150k indexed `[id, account_id]`). The catalog's `present` set is **names**, not table objects (a latent bug made joined-table filter attribution dead). `sql` tasks are graded on intent via `task.check(analysis)` and always render a `QueryAnalysisPanel` in `LessonView`; bad→good sql lessons (12) carry `vs?: string` (the broken starter) + `mustAvoid?: WarningCode[]`, pass only when the check holds AND no mustAvoid warning fires, and surface a Before→After `ReadsAnimation` meter via `data = { analysis, before? }`. The SQL editor is seeded with `vs` (the broken "before" query) or blank when there is no `vs` — it never pre-fills the solution; `defaultSql` is only the canonical answer the tests grade against. Lesson content is keyed by lesson id (`key={lesson.id}` on the blocks container) so per-task state (attempt counter, ✓/× result, selected option) can never leak into the next lesson when navigating via the sidebar/Next. `BufferTask` supports `requiresAll?: boolean` (all listed configs must clear budget). `ChallengeWorkspace` also shows a live `QueryAnalysisPanel` on the plan/btree capstones built from `challenge.rowCounts` + the submitted index column.
- `src/lib/store/useProgressStore.ts` — added `lessons: Record<LessonId, {completedAt, grade: 1|2}>`, `recordLesson`, `lessonCompleted`, `lessonCount`, `lessonsForUnit`, `unitOfLesson` (now covers the 5 units: foundations/storage/indexes/execution/transactions) + badge milestones `student/scholar/storage_ready/index_savvy/execution_ready/transaction_ready` + the original 6; first-try pass is grade 2, retry is 1.
- **Challenge evaluation is a closed-form static model — it NEVER executes DuckDB.** Reason (verified repeatedly): duckdb-wasm 1.32 crashes with the un-catchable Emscripten `_setThrew is not defined` when a challenge SQL materializes the heavy seed tables (`events` 500k, etc.) — the worker dies and the app's shared engine is poisoned. `evaluateChallenge(challenge, submission, opts)` (no runtime object; signature changed from the runtime-based one). Reads/scanMode come from `challenge.rowCounts` + `indexLookupPageCount`/`seqPageCount`/`correlatedReadCount`; `RESULT_SET_MATCH` is graded by `structuralResultPass` (SQL-text intent: missing_index → `WHERE user_id` + `id`; n_plus_one → `JOIN` and not correlated). The Query Plan lab (small demo tables + user-typed ANALYZE explain) remains the live-EXPLAIN surface.
- `ChallengeWorkspace.tsx` has **zero** DuckDB imports now (initEngine/planSql/runSql/ensureSetup removed); the plan/btree right pane shows the static before/after page reads. It takes `initialChallengeId` and is remounted by the parent via a changing React `key` when deep-linking from a capstone (the `react-hooks/set-state-in-effect` lint rule rejects the old effect-based deep link).
- `scripts/e2e.mjs` navigates straight to `/plan` (the Query Plan lab boots the engine and auto-runs the sample query there).
- Verification: Node task tests (**115 checks**, `learn-test.mjs` at repo root — every lesson has exactly one task except capstones; use `node --experimental-strip-types --experimental-loader <tsloader> learn-test.mjs`), challenge engine tests (**15 checks**, `challenge-test.mjs` at repo root — static eval under all 5 challenges, structural intent checks, buffer trace monotonicity, deadlock model, and a tiny ConcurrencySim isolation harness), headless-Chromium probes for both the challenge workspace and the Learn flow (lesson → task pass → completion banner → capstone deep-link). All green plus `lint`/`build`/`check:e2e`.
- The DuckDB worker protocol is now **`init` + `explain` only**; the old `plan`/`query` message paths (`runPlan`/`runSql` in the client) were removed as dead code when challenge evaluation went static — do not resurrect them.

**Phase 4 (Storage Engine & Buffer Pool Simulator) is specified in this file but NOT implemented** — the prompt at `### Phase 4` above is the unimplemented spec; do not claim it is delivered. (Its math is partially exercised by the buffer lesson task and the `buffer_thrash` capstone via `simulateBufferPool`.)

## Phase 7: Worked Math, Live Capstone Animations & Mongeesy-style Learn chrome

Shipped to make numbers show their arithmetic and to let capstones pair reading SQL text with watching reads. Facts:

- **Every number task now shows steps.** `NumberTask.work?: string[]` added to `taskEngine.ts`; `work` arrays live in `curriculum.ts` on `memory-vs-disk` (1,000× multiplier), `pages-work` (625 pages), `rows-pages` (1,563 pages), `seq-scan-cost` (313 pages + I/O ms). `LessonView` reveals them only **after** a Check attempt via `WorkedCalc` ("How it's calculated").
- **`QueryAnalysisPanel`** ("How this is calculated" `<details>`) prints per-table formulas — `seq: ⌈rows ÷ 64⌉ = pages` / `index: ⌈log₅₁₂ rows⌉ + 1 = pages` — then `reads(+writes) × 0.1 ms/page = est ms`. `fmt` = `Intl.NumberFormat("en-US")` so 500,000 renders with commas. The `<details>` body starts closed (probe must expand before asserting inner text).
- **`ReadsAnimation`** (`src/components/challenge/ReadsAnimation.tsx`): segment-based page-read costometer (`{label, pages, kind: seq|index|write}`) with Play/Pause/Step/speed, a cumulative `pages ≈ ms` counter, and a formula footer. Reset by **remount via `key`** (React-hooks lint forbids setState-in-effect). `ChallengeWorkspace` maps `queryAnalysis` → `readSegments` (missing_index: `events seq 7,813` → toggling "Create B-Tree index" swaps to `id index ~4`) and shows the animation under the plan/btree capstone; buffer/concurrency capstones get a static `SqlCaption` statement box ("Workload being animated" / "Statements being animated").
- **Mongeesy-style lesson chrome** (`CourseSidebar` module rail + "Course · 60 lessons" header + course progress bar, lesson header "Lesson N of 60" + per-lesson progress, task card relabeled "Try it out").
- **Hydration/cold-start gotchas (verified in prod, cost me a while):**
  - `useSyncExternalStore(subscribe, getProgress, getServerSnapshot)` — passing `getProgress` as the server snapshot leaks persisted localStorage into the hydration render and can throw React **#418** intermittently. Use `() => INITIAL` for the server snapshot; the store re-reads localStorage on client mount. (Learn-home measure is fine — localStorage doesn't touch SSR.)
  - **Never let a second `next-server` sit on :3000.** `npm run start` failing with `EADDRINUSE` (errno -48) leaves the *old* dev/start server holding the port **serving stale chunk hashes that the new `rm -rf .next` build no longer contains** → phantom `HTTP 500 /_next/static/chunks/*.js` (a chunk the served HTML references but disk doesn't) → the page never hydrates ("Engine idle" pill persists, clicks no-op). Kill with `pkill -9 -f "next-server"` (the process cmd is `next-server (v16.3.5)`, so `pkill -f "next start"` alone misses it), verify `lsof -ti :3000` is empty, then start. Symptom cleanups previously misread as missing assets or hydration bugs were this.
  - Headless probes should wait for hydration before first click; cold-start mounts are a beat slower than warm ones. The reliable cross-page signal is the shared header's 5 nav links (`header nav a`); the "Engine idle" pill only exists on `/plan` now (it moved into PlanLab's SQL toolbar).
  - `learn-test` is now **388 checks** (per-lesson loop asserts `lessonFor` + unique ids + exactly one task per content lesson for all 60, every plan-choice/number/btree lesson is auto-graded correct-answer-passes/wrong-fails, every number task has a non-empty `work` array, the 10 bad→good sql lessons enforce `vs`/`mustAvoid` with a Before→After reads drop, the 3 new warnings fire in isolation, `lru-vs-clock` requires both 16-frame policies, dirty-read/non-repeatable isolation labs gate levels, per-unit content counts = 9/11/11/13/11), `challenge-test` remains **15 checks**. Prod probe **20/20**: Mongeesy chrome, worked calc reveal, SQL math footer (after expanding the details), Missing Index ReadsAnimation SEQ→IDX transition + Play counter, buffer/dirty-read captions, zero console errors across all four sections. New Learn-flow probe: the `dirty-read-anomaly` lesson passes at READ COMMITTED ("Lesson complete."), the `archive-with-where` bad→good exercise fails the unfiltered UPDATE (`×`) and passes the scoped one with the Before→After reads meter rendered, zero console errors.

## Phase 8: App Router routes (tabs + lessons as URLs)

Replaced the old single-page `view`/`openLessonId` React-state orchestration so every tab and lesson is a real, indexable, reload-safe URL. Facts:

- **Routes:** `/` → landing page (Phase 9, was `redirect("/learn")`); `/learn` (`LearnHome`); `/learn/[lessonId]` (SSG via `generateStaticParams` over all 60 lessons, `generateMetadata` sets the lesson title, unknown ids `notFound()`); `/plan` (`PlanLab` — engine init + sample auto-run moved here from page.tsx); `/btree`; `/isolation`; `/challenges` (hub); `/challenges/[challengeId]` (SSG over the 5 challenges, deep-link target for capstones). Tab pages are thin **server** wrappers (metadata export) rendering their client bodies; `build` emits 74 pages (60 lesson + 5 challenge SSG).
- **Self-navigating client components:** `LearnHome` and `LessonView` dropped their `onOpenLesson`/`onBack`/`onNext`/`onOpenChallenge` props and call `router.push(...)` themselves (`useRouter` from `next/navigation`): back → `/learn`, next/prev/sidebar → `/learn/<id>`, capstone → `/challenges/<challengeId>`. LessonView keeps `key={lesson.id}` on the blocks container (per-lesson TaskRunner state must not leak).
- **Next 16 gotchas:** `params` is a `Promise` — server pages `await params`, client pages would `use(params)` (prefer thin server pages + `PageProps<'/route'>`). `generateMetadata`/`generateStaticParams` are exported from the page file; `redirect` comes from `next/navigation`.
- **Old header widgets moved:** the engine status pill + Run button now live in `PlanLab`'s SQL toolbar (they only ever applied to `/plan`). The old `page.tsx` `view` state, `capstoneLink`, and the plan JSX are gone — do not reintroduce a state-based tab switcher.
- **Verification:** `npx tsc --noEmit`, `npm run lint`, `npm run build` (74 routes), `learn-test.mjs` (388), `challenge-test.mjs` (15), `npm run check:e2e` all green; headless route probe 10/10 (root redirect, lesson SSG + sidebar jump + reload persistence, active tabs on every route, plan graph boots, challenge deep-link, zero console errors).
- **`tsloader.mjs` at repo root** (tiny resolve hook appending `.ts`) is required by `node --experimental-strip-types --experimental-loader ./tsloader.mjs learn-test.mjs` — extensionless relative TS imports fail without it.

## Phase 9: Landing page + light/dark theme

### Landing page

- `/` is now a real **SSG landing page** (server component, `src/app/page.tsx`, exports `metadata`), not a redirect. Scrollable root = `min-h-0 flex-1 overflow-y-auto` (the layout body is still `h-screen flex-col overflow-hidden`). Hero + stats band (60 lessons / 5 capstones / 4 labs / 0 servers), four module cards linking `/plan`, `/btree`, `/isolation`, `/challenges` plus CTAs to `/learn`, a `#how-it-works` anchor strip, and the unit roster imported from `src/lib/lessons/curriculum.ts` (`UNITS`).
- The header logo on all pages points at `/` (not `/learn`) now.
- **Shared header details (Phase 8):** `src/components/layout/AppHeader.tsx` lives in `src/app/layout.tsx` (client component using `usePathname()`; active tab = `pathname === href || startsWith(href + "/")`, `aria-current="page"`). Body is `h-screen flex-col overflow-hidden` — pages fill `flex-1 min-h-0` so `h-full`-rooted components keep working via a `min-h-0 flex-1` wrapper.

### Theme system (Tailwind v4, class-based)

- Token source of truth is `src/app/globals.css`. `@custom-variant dark (&:is(.dark *));` enables `dark:` variants. The **zinc scale is remapped via CSS variables** — `:root` holds the inverted light palette, `.dark` restores stock zinc:
  - Light: `--dz-50:#0a0a0a … --dz-500:#71717a … --dz-800:#e4e4e7, --dz-900:#f4f4f5, --dz-950:#fafafa` (i.e. `bg-zinc-950` = page bg → white in light), `.dark` = stock zinc (950 `#09090b`).
  - Because of the inversion, **zinc utility classes are self-themed with NO `dark:` variant**: the component author writes dark-first classes (`bg-zinc-950` page, `bg-zinc-900` panels, `bg-zinc-800` raised, `border-zinc-800` dividers, `text-zinc-50`/`100` strong text, `text-zinc-400` body, `text-zinc-500` muted) and they render correctly in light. Do NOT write `text-zinc-900 dark:text-zinc-50`-style pairs for zinc — `dark:` is only for **accent** shades.
- Accents (emerald/sky/amber/rose/red/violet/cyan/orange) keep semantically-dark tokens: bright *text* gets a darker light twin (`text-emerald-600 dark:text-emerald-400`), deep tint-*panels* get a light tint (`bg-emerald-100 dark:bg-emerald-950/40`), deep *borders* get a lighter border (`border-emerald-200 dark:border-emerald-800`). Solid `bg-emerald-600 text-white` buttons and `border-emerald-600` chips are untouched.
- There is a **codemod** at `scripts/theme-codemod.mjs` (plain JS, string-path walk over `src/components`) with the full accent map — run it if new accent usages accumulate. **Known codemod traps:** `matchAll(...).length` is always `undefined` (use `split(from).length - 1` or a counted regex); exact-match `split/join` corrupts suffixed tokens (`text-emerald-300` matching inside `dark:text-emerald-300/90`) — the current version uses a boundary-aware regex `from + "(?![A-Za-z0-9./_-])"`. It replaced 188 class strings across 14 files.
- **Theme switching:** `src/lib/theme.tsx` (`ThemeProvider`/`useTheme`, `THEME_KEY="dblearn.theme"`). The root layout inlines an anti-flicker script in `<head>` that adds `.dark` before paint (localStorage → `matchMedia`); `theme.tsx` syncs the class, `colorScheme`, and persists. `<html>`/`<body>` carry `suppressHydrationWarning`.
- **Hydration gotcha (verified, would be a misleading #418):** the header theme-toggle button rendered sun-or-moon based on stored theme → server HTML had the other icon → reload with `.dark` persisted threw React #418 on **every** route. Fix: the button always renders **both** SVGs and toggles visibility with a CSS class — DOM structure is constant, so hydration never differs. Never render theme-switching icon *choice* in JSX; toggle `hidden`/`block`.
- **Monaco theme** follows the app theme: `SqlEditor` takes a `dark` prop (`theme={dark ? "vs-dark" : "light"}`); `PlanLab` and `ChallengeWorkspace` pass `dark={theme === "dark"}` from `useTheme()`.
- Every route was probed in headless Chromium in both themes (light body `rgb(250,250,250)`, dark `rgb(10,10,10)`, toggle persists across reload) with zero console errors.

## Query Plan lab bugfixes (verified against 1.32.0 bundle)

- **Plan graph height collapse:** `/plan`'s body is `flex h-screen flex-col overflow-hidden`, and `PlanLab`'s root grid is a *direct flex child* of that body — so it needs `flex-1` itself (`grid min-h-0 flex-1 …`). A `min-h-0 flex-1` page-wrapper alone does **not** fix it (the grid also needs `h-full`). The editor/graph collapsed to ~68–140px on a 900px viewport before this; now `.react-flow` fills ~816px.
- **Space key dropped in the SQL editor (Monaco 0.56 + React Flow 12):** Monaco 0.56 inputs through Chrome's EditContext API, whose focused element is a plain `DIV.native-edit-context` — *not* an input/textarea/`contenteditable` node. React Flow's `useKeyPress('Space', { target: win })` window keydown (installed by FlowRenderer because `<ReactFlow>` defaults `panActivationKeyCode = 'Space'`) therefore **misses** its `isInputDOMNode` guard (checks `inputTags` + `contenteditable` + `.nokey`), matches the bare Space, and calls `event.preventDefault()` — killing Chromium's text insertion (no `beforeinput` fires), so the character is silently lost. Letters are unaffected. **Fix:** pass `panActivationKeyCode={null}` to `<ReactFlow>` in `src/components/plan-graph.tsx` (prop type is `KeyCode | null`; `useKeyPress` registers no listener when the code is `null`). Do not reintroduce Space-pan on that page.

## Phase 10: Mobile responsiveness + installable PWA

- **Responsive (all verified headless at 390×844, zero console errors, no horizontal overflow):**
  - `AppHeader.tsx` — desktop nav hidden below `md`; hamburger toggles an absolute dropdown (`relative z-50` header holds it). The hamburger and X SVGs are **both always in the DOM**, visibility toggled by CSS — same React-#418 rule as the theme toggle. No icon library anywhere; all icons are inline SVG.
  - `/plan` — `PlanLab` root grid is `grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(360px,42%)_1fr] lg:grid-rows-1` (editor stacks above graph on phones).
  - `/btree` — canvas `h-[46vh] min-h-[260px]` above a full-width stats `<aside>` (`flex-col lg:flex-row`, `lg:w-[300px]`, `lg:overflow-y-auto`); `BTreeCanvas` svg is `max-w-full h-auto` so big trees scale down; `BTreeControls` grid is `grid-cols-2 sm:grid-cols-4` with a `flex-wrap` transport row.
  - `/challenges` + `/challenges/[id]` — the pane grid is natural-height `grid-cols-1` on phones (`lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(240px,280px)_minmax(360px,1fr)_minmax(380px,1fr)] lg:overflow-hidden`); Monaco is boxed to `h-[360px]` on mobile (`lg:flex-1`); right/center sections drop the old `min-h-[420px]`/`min-h-[480px]` (content drives height). Horizontal-side borders move to bottom borders on phones.
  - **Mobile scrolling is DOCUMENT-level, not nested.** `layout.tsx` body is `flex min-h-screen flex-col lg:h-screen lg:overflow-hidden` — on phones the `h-screen`/`overflow-hidden` chain (which reaches below the visible viewport on iOS Safari and killed touch scroll) is dropped, so the page grows to content and the document scrolls natively. Pages that must page-scroll (`/btree`, `/challenges`, `/challenges/[id]`) use a wrapper with `lg:min-h-0 lg:flex-1 lg:overflow-hidden` (natural height on mobile, fixed app-shell scroll on `lg`). Pages with component-internal scrolling (`/plan` `PlanLab` `grid min-h-0 flex-1`, `/isolation`, learn tabs, landing `<main className="min-h-0 flex-1 overflow-y-auto">`) keep their base `flex-1`/`min-h-0` so they still fill the fixed-height body on mobile exactly as before. Do not put `overflow-y-auto` on an auto-height element to "fix" mobile scrolling — only definite-height ancestors scroll, and `100vh` chains clip on iOS.
  - `/learn/[lessonId]` — `px-4 sm:px-6`. Landing course-track rows stack (`flex-col sm:flex-row`) so taglines wrap fully instead of ellipsizing on phones. Landing, `LearnHome`, `Isolation`, and `PlanInspector` (`w-[min(420px,85%)]`) were already responsive.
- **PWA (fully offline-capable, no external assets — window/ios/Android installable):**
  - `public/manifest.webmanifest` — `display: standalone`, `id/start_url/scope "/"`, `background`+`theme_color #0a0a0a`, 5 icons (192/512 any, `icon.svg`, maskable-512).
  - `public/icons/*` generated by `scripts/gen-icons.mjs` (single SVG "database cylinder" mark → sharp PNGs at 192/512/maskable-512/apple-180; `sharp` is a Next.js dep, no new packages).
  - `public/sw.js` — versioned `dblearn-v1` precache (app shell + manifest + icons), cache-first `/_next/static/*` + `/db/*` (hashed/immutable), network-first navigations with cached-page → `/` fallback, stale-while-revalidate for everything else. Bump `VERSION` on release.
  - `src/app/layout.tsx` — metadata adds `manifest`, `icons`, `appleWebApp` (capable, `black-translucent` status bar); **`themeColor` lives in the `viewport` export** (Next 16 rejects it in `metadata` with a `Unsupported metadata themeColor` dev warning); the two inline scripts are `next/script` elements — `theme-init` (`strategy="beforeInteractive"`, anti-flicker) in `<head>`, `sw-register` (`afterInteractive`, on `window.load`, guarded by `"serviceWorker" in navigator`) in `<body>`. Raw `<script>` tags in the head tree made React 19 log `Encountered a script tag while rendering React component`.
  - SW never registers in SSR/dev-render — it's client-side only. Old SW versions are purged in `activate` by prefix match on `dblearn-`.

## Dev-hydration gotchas (verified against Next 16.3.5 dev + Turbopack)

- **B-Tree node ids must be per-BTree-instance** (`private nextNodeId` + `newId()` in `src/lib/engine/btree.ts`). The old module-global `nodeId()` counter diverged across JS realms: the SSR realm allocates different numbers of ids before the playground's first tree than the browser realm, so a freshly-built tree rendered `n2` in server HTML but `n0` in hydration → **React #418 "server rendered text didn't match"** on every `/btree` load (dev surfaced it; the failed hydration also cascaded into the dev server cancelling in-flight RSC streams, which Turbopack logs as `⨯ Error: Canceled: Canceled`, surfaced to the editor by Console Ninja as `[ ERR Canceled: Canceled`). Keep ids deterministic; never reuse a module-scope counter for SSR-ed UI keys.
- `themeColor` in `metadata` is deprecated in Next 16 (dev warns and emits an unsupported meta); move it to the `viewport` export.

## Analytics (PostHog)

- **Explicit exception to the "no network calls" rule** (below): user-requested, `src/lib/dblearnlytics.ts` (a port of mongeesy's `phuglytics.js`). Everything else stays offline-first.
- **Same project/token as mongodb-easy** via `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` (in gitignored `.env`; `.env.example` is the committed template). To isolate streams, every event carries a literal `app: "dblearn"` property. Storage uses posthog's default `ph_` namespace, so the device id is **shared** with mongeesy (same project/token); the `app` property is the ONLY isolation mechanism (`persistence_name` doesn't exist in posthog-js ~1.372). In the PostHog dashboard, filter/breakdown by the `app` property (mongeesy events come through untagged unless they add the same tag — do **not** edit mongeesy).
- SDK reaches PostHog via a same-origin `/tt` reverse proxy (ad-blocker evasion, mirrors mongeesy's `api_host`): `next.config.ts` rewrites `/tt/:path*` → `NEXT_PUBLIC_POSTHOG_HOST`. This requires `next start`/Vercel (rewrites are unsupported for static `output: export`).
- `capture_pageview: false` + manual `$pageview` on route change; autocapture/surveys disabled. Offline captures queue in localStorage `dblearn-analytics-queue` (max 500) and flush on `online` — the PWA stays offline-capable.
- Events: `$pageview`, `cta_clicked`, `lab_opened`, `lesson_started`, `lesson_completed`, `unit_completed`, `course_completed`, `query_run`, `query_error`, `challenge_started`, `challenge_attempt`, `challenge_completed`, `hint_revealed`, `scenario_run`, `$exception` (via `captureException`). Wiring lives in `AnalyticsProvider` (layout), `TrackedCta` (landing), `LessonView`, `PlanLab`, `ChallengeWorkspace`, `BTreePlayground`, `ConcurrencyPlayground`. All helpers no-op when the key is unset/malformed.
- **Verified against `posthog-js@~1.372.10` / `@posthog/react@~1.9.0`** (exactly mongeesy's pins; `^` installs 1.434, use `~`). Import **`posthog-js/dist/module.full`** (synchronous full ESM bundle) — the default `posthog-js` lazy entry stalls load config.js/static extensions and `window.posthog` stays undefined in ESM (normal).
- **Bot filtering is the silent-events trap:** posthog drops every capture when `_is_bot()` returns true (headless "Google Chrome for Testing" is flagged), gate at capture: `!this.config.opt_out_useragent_filter && this._is_bot()`. Init config must set `opt_out_useragent_filter: true` (verified: with it set, captures enqueue even with `bot:true`). Real users aren't bots, so this mainly matters for headless probes.
- **Capture bodies are gzip-compressed batch POSTs.** `analytics-probe.mjs` (repo root) decodes via `request.postDataBuffer()` + `gunzipSync` and intercepts `/tt` event POSTs (fulfilled `{"status":1}`, never reaching PostHog); `$pageview` (landing + route changes, `app:"dblearn"`), `cta_clicked` (landing hero — select by `a[href="/learn"]` filter `hasText:"Start lesson one"`, NOT `.first()` which matches the header nav tab), `lesson_started`, zero console errors. Run: `node analytics-probe.mjs` (needs prod server on :3000; chromium via `PLAYWRIGHT_CHROMIUM`).

## Non-negotiables

- Zero server latency: all execution in Web Workers; offline-capable; no network calls.
- Pair every visual with a first-principles explanation (I/O costs, page scans, cache eviction).
- Production-grade, fully typed TypeScript; modular phase-by-phase delivery; no hand-wavy placeholders.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
