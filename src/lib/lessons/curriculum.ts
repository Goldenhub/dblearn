/**
 * Learn curriculum.
 *
 * A progressive, Mongeesy-style course: five units arranged as a single track,
 * starting from what a database and I/O actually *are*, then working up through
 * storage, indexes, query execution (including writing real SQL and reading
 * what it does to the database), and transactions. Every lesson is a short
 * proof (prose) plus a first-principles callout and one small auto-graded task.
 * The five production incidents are folded in as the capstone of the unit that
 * teaches the skills they need.
 *
 * Tasks never execute DuckDB — the number/btree/isolation/buffer tasks use the
 * pure-TS engines, and the `sql` tasks are graded on intent by a static
 * analyzer (lib/lessons/queryAnalyzer.ts) that also explains, in plain
 * language, which tables the query touches and at what page-read cost. The
 * course works instantly and cannot be taken down by a wasm hiccup.
 */

import type { LessonTask } from "../lessons/taskEngine";
import type { ChallengeCategory } from "../engine/challengeEngine";
import type { CatalogTable } from "../lessons/queryAnalyzer";

export type LessonBlock =
  | { kind: "prose"; markdown: string }
  | { kind: "callout"; title: string; body: string }
  | { kind: "task"; task: LessonTask }
  | { kind: "capstone"; challengeId: string; note: string };

export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  intro: string;
  blocks: LessonBlock[];
}

export interface Unit {
  id: string;
  title: string;
  tagline: string;
  category: ChallengeCategory;
  lessons: Lesson[];
}

/**
 * The lesson SQL catalog — the tables learners write queries against. Shared by
 * every `sql` task. Row counts and index columns drive the analyzer's page cost.
 * `user_id` on events is deliberately NOT indexed so learners can experience
 * (and then fix) a sequential scan over 7,813 pages. `name` on products is
 * deliberately NOT indexed for the leading-wildcard and "cast breaks an index"
 * lessons, while the columns learners are told to filter on (sku / id /
 * customer_id / account_id) are.
 */
export const LESSON_SQL_CATALOG: CatalogTable[] = [
  { name: "customers", rows: 20_000, indexedColumns: ["id"] },
  { name: "orders", rows: 200_000, indexedColumns: ["order_id", "customer_id"] },
  { name: "events", rows: 500_000, indexedColumns: ["id"] },
  { name: "products", rows: 5_000, indexedColumns: ["id", "sku"] },
  { name: "payments", rows: 150_000, indexedColumns: ["id", "account_id"] },
];

export const UNITS: Unit[] = [
  /* ------------------------------------------- Unit 1: Foundations */
  {
    id: "foundations",
    title: "Unit 1 · What a Database Is",
    tagline: "Memory, disk, and the two paths every query takes: read and write.",
    category: "buffer",
    lessons: [
      {
        id: "what-is-a-db",
        title: "What a database is",
        minutes: 4,
        intro:
          "A database is not a spreadsheet file — it is a program that stores, retrieves, and guarantees your data.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "At its core a **database manager** does three jobs over raw files:\n\n1. **Store** — write rows somewhere durable (disk), organized into fixed-size pages.\n2. **Query** — answer questions (\"all orders for customer 5\") faster than a naive file scan, using indexes and clever read strategies.\n3. **Guarantee** — survive crashes, keep concurrent transactions consistent, and never silently lose committed writes.\n\nEverything else in this course is the *how*: pages, buffer pools, B-Trees, WAL, locks. When a service \"uses a database\", it is really hiring this program — and every query you write is a small contract it has to fulfill.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A query's real cost is the I/O the storage engine must do, not the SQL text. The database only promises *answers* — the number of disk pages read is the bill. Every technique in this course reduces that bill.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Which of these is the database manager's job?",
              answer: "storage",
              options: [
                { id: "storage", label: "Store rows durably, answer questions via indexes, and keep ACID guarantees" },
                { id: "ui", label: "Render web pages and manage HTTP routes" },
                { id: "compile", label: "Compile your source code into binaries" },
              ],
              why: "A DBMS persists pages to disk, answers queries with index-driven reads, and upholds transaction guarantees — the other two are an API server and a compiler.",
            },
          },
        ],
      },
      {
        id: "memory-vs-disk",
        title: "Memory vs disk: the latency gap",
        minutes: 5,
        intro:
          "The single most important number in databases: a disk read is ~1,000× slower than a main-memory read.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A CPU core can reference main memory in about **100 ns**. Reading one **8 KiB page** from an SSD takes roughly **0.1 ms** — i.e. 100,000 ns. That is a **1,000×** gap. A spinning HDD is tens of times slower again.\n\nThe consequence: one page fault to SSD is as expensive as *a thousand* memory references. Databases therefore reuse pages aggressively: a page fetched into the buffer pool can answer thousands of lookups without touching disk again. When you see a query 'spend everything' on I/O, this ladder is why.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Memory ≈ 100 ns, SSD page read ≈ 0.1 ms (1,000×), HDD ≈ 10 ms (100,000×). Query optimization is mostly *page-read avoidance*: fewer, bigger, hotter pages. Caches win because the gap is enormous.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "Main memory lookup ≈ 100 ns; one SSD page read ≈ 0.1 ms (100,000 ns). How many times slower is the SSD page read?",
              hint: "100,000 ÷ 100.",
              answer: 1000,
              work: [
                "Latency unit conversion: 0.1 ms = 0.1 × 1,000,000 ns = 100,000 ns per SSD page read",
                "Memory reference = 100 ns",
                "Ratio = 100,000 ns ÷ 100 ns = 1,000×",
              ],
            },
          },
        ],
      },
      {
        id: "ssd-hdd-cliff",
        title: "SSD vs HDD: the second cliff",
        minutes: 4,
        intro:
          "Not all disks are equal — an SSD page read is ~100× faster than a spinning platter, and the engine's strategy depends on which it is.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "The memory-versus-disk gap was one cliff; there is a second one *inside* disk. A solid-state drive (SSD) reads one page in about **0.1 ms**. A spinning hard drive (HDD) needs about **10 ms** — a **100×** gap.\n\nWhy it matters: a database whose hot set fits on SSD feels instant; the same design on HDD thrashes. High-end engines steer sequential log traffic and hot indexes toward the media that suits them, and keep the numbers straight all the way up the ladder.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Latency ladder: memory ≈ 100 ns → SSD page ≈ 0.1 ms (1,000×) → HDD page ≈ 10 ms (another 100×). Memory to HDD is ~100,000×. Every caching and indexing trick converts disk reads into memory reads.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "An SSD reads a page in 0.1 ms; a spinning disk in 10 ms. How many times faster is the SSD page read?",
              hint: "10 ms ÷ 0.1 ms.",
              answer: 100,
              work: [
                "HDD page read = 10 ms",
                "SSD page read = 0.1 ms",
                "Ratio = 10 ms ÷ 0.1 ms = 100×",
              ],
            },
          },
        ],
      },
      {
        id: "how-reads-work",
        title: "How a read actually happens",
        minutes: 6,
        intro:
          "Before returning rows, the engine must get the pages holding them into memory — and it only does so on a *miss*.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "You run `SELECT …`. The database does not touch disk directly. It walks this path:\n\n1. **Parse + plan** — turn SQL into an operator tree (scan, join, sort…).\n2. **Buffer pool lookup** — for each page the query needs, check the in-memory pool first.\n3. **Hit?** Use the page already in RAM — no disk I/O at all.\n4. **Miss?** Allocate a frame, read the page from disk (one 0.1 ms read), then use it.\n5. **Return rows** built from the in-memory pages; the page stays cached for the next query.\n\nThe buffer pool is what turns 'the query read pages' into 'the query read *new* pages'. A warm cache answers in microseconds; a cold one pays the disk bill.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Every SELECT is a sequence of page lookups. Reads only touch disk when the page is absent (a miss). Cache-hit ratio is the health metric — the fraction of lookups that found their page already resident.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Your query needs page 42 and it is NOT in the buffer pool. What happens?",
              answer: "miss",
              options: [
                { id: "miss", label: "Miss — read page 42 from disk into a free frame, then use it" },
                { id: "abort", label: "Fail the query — a missing page is an error" },
                { id: "copy", label: "Silently use an empty page so the query never blocks" },
              ],
              why: "A buffer-pool miss triggers exactly one disk read (0.1 ms), then the page becomes resident and is reused. Missing is not an error — it is the cost of a cold cache.",
            },
          },
        ],
      },
      {
        id: "latency-ladder-review",
        title: "The full latency ladder",
        minutes: 4,
        intro:
          "One climb, all three rungs: RAM, an SSD page, a spinning platter — the gap every database trick is built around.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Build the ladder once, from the CPU's point of view:\n\n1. **Main memory:** ~100 ns (1×).\n2. **SSD page read:** ~0.1 ms = 100,000 ns (1,000×).\n3. **HDD page read:** ~10 ms = 10,000,000 ns (100,000× from memory).\n\nA query that fits in RAM answers in microseconds. One that must fetch fresh pages off an SSD answers in milliseconds — and one that hits cold spinning disks, in tens of milliseconds. Memorize the ratios rather than the absolutes: a thousand, then a hundred thousand.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "1 (RAM) : 1,000 (SSD) : 100,000 (HDD). Moving a lookup from disk to RAM wins 3–5 orders of magnitude. Caches, indexes, WAL, and buffer pools are this single gap, weaponized.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "A memory lookup is ≈ 100 ns and an HDD read is ≈ 10 ms. How many times slower is the spinning disk?",
              hint: "10 ms = 10,000,000 ns; divide by 100.",
              answer: 100000,
              work: [
                "HDD read = 10 ms = 10,000,000 ns",
                "RAM reference = 100 ns",
                "Ratio = 10,000,000 ns ÷ 100 ns = 100,000×",
              ],
            },
          },
        ],
      },
      {
        id: "how-writes-work",
        title: "How a write actually happens",
        minutes: 6,
        intro:
          "Writes are reads plus work: load the page, modify it in memory, then make that change durable — in the right order.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`UPDATE balance = 400 WHERE id = 1` never rewrites the whole disk file. Typical engine path:\n\n1. **Read the page** holding the row into the buffer pool (same as any read).\n2. **Dirty it** — modify the in-memory copy and mark the frame *dirty*.\n3. **WAL first** — append a log record describing the change to the write-ahead log, and flush that log to disk.\n4. **Lazily flush** — the dirty page is written back to its disk block later (on eviction or at checkpoint).\n\nWhy log first? If the machine crashes between 'dirtied in memory' and 'flushed to disk', the WAL record survives and the change can be replayed on restart. The rule: a page may only hit disk **after** its log record is durably committed — *write-ahead*.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A write = a read (to bring the page in) + an in-memory mutation + an ordered WAL flush. The WAL is cheap sequential I/O; rewriting scattered dirty pages on every txn would be expensive random I/O. Durability is bought cheaply with sequential logs, paid for later in background flushes.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "You UPDATE row 7; its page is loaded, modified, and marked dirty. What must happen BEFORE the page may be flushed to its disk block?",
              answer: "wal",
              options: [
                { id: "wal", label: "The matching WAL record must be committed to the log" },
                { id: "lock", label: "The page must be pinned by one reader forever" },
                { id: "nothing", label: "Nothing — dirty pages can flush at any time, even before logging" },
              ],
              why: "Write-ahead logging: a dirty page is only safe to flush once its change is durably in the log, so a crash can replay it. Flushing early would let the disk block be newer than the log.",
            },
          },
        ],
      },
      {
        id: "cache-misses-dominate",
        title: "Cache misses are the whole bill",
        minutes: 5,
        intro:
          "A query's latency is really its number of misses times disk latency — every optimizer trick is miss avoidance.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Stack 1,000 page lookups. If 990 hit the buffer pool and 10 miss, the hits cost microseconds each and the 10 misses cost ~0.1 ms each: the misses drive ~98% of the latency. Push the hit ratio to 50% and the bill grows tenfold.\n\nSo 'the query is slow' almost always means 'the query missed the cache too often'. Indexes operate one level up on the same principle: they stop *wanted* pages from being fetched at all, so there are fewer lookups to hit or miss.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Query latency ≈ (cache misses) × disk latency. Hits are free; misses are the bill. Read plans and size caches to shrink the second factor — never the first.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "A service does 1,000 page lookups; 990 hit the pool and 10 miss. Where does almost all the latency come from?",
              answer: "misses",
              options: [
                { id: "misses", label: "The 10 disk misses — each ≈ 0.1 ms vs microseconds per hit" },
                { id: "hits", label: "The 990 hits — more work happens per hit" },
                { id: "cpu", label: "CPU time parsing and planning the query" },
              ],
              why: "Each miss is a disk read (~0.1 ms); each hit is a memory reference (~100 ns). The handful of misses dominates the total.",
            },
          },
        ],
      },
      {
        id: "pages-work",
        title: "Pages: the unit of I/O",
        minutes: 5,
        intro:
          "Everything — reads, writes, indexes, the buffer pool — is done in fixed-size pages. Rows live inside them.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A page is a fixed-size block — here **8 KiB**. It is the smallest thing the storage engine reads or writes. A row never crosses the disk alone; if you want one row you fetch the whole page that holds it.\n\nRow layout matters: a 128-byte row means $8,192 ÷ 128 = 64$ rows per page. A 100,000-row table spans $⌈100,000 ÷ 64⌉ = 1,563$ pages. That single number — *pages* — is the true 'size' of a table, because it is the number of disk reads a full sweep costs.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Pages decouple I/O from rows: you pay per page, not per row. Table size in pages = ceil(rows ÷ rows-per-page). The whole course's math (scan cost, index depth, buffer frames) is page arithmetic on top of this.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "8 KiB page (8,192 bytes) with 128-byte rows. A 40,000-row table has how many pages?",
              hint: "ceil(40,000 ÷ 64).",
              answer: 625,
              work: [
                "Rows per page = 8,192 bytes ÷ 128 bytes = 64",
                "Pages = ⌈40,000 ÷ 64⌉ = ⌈625⌉ = 625",
              ],
            },
          },
        ],
      },
      {
        id: "durability-vs-performance",
        title: "Durability vs performance",
        minutes: 6,
        intro:
          "Every commit is a promise to survive a power cut — and a promise on disk costs a physical write. The database spends that budget carefully.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A transaction that mutates twenty pages must make that change *durable*. Flushing all twenty pages to disk at commit would mean twenty scattered random writes per transaction. Instead the engine appends one small record to the **write-ahead log** and fsyncs — forces — that single sequential write. Cheap. The dirty pages flush later in the background.\n\nThat is the trade distilled into one knob: with sync on, the commit ACK waits for the fsync; with sync off the ACK returns instantly but the last few committed writes can vanish on a crash. Group commit batches many transactions into one fsync to buy both.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Durable = on disk, not in RAM. WAL turns one transaction of random page writes into a single ordered fsync. Every 'durability level' setting you meet later is that trade, spelled out.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Which makes a multi-page transaction durable with the least I/O per commit?",
              answer: "wal",
              options: [
                { id: "wal", label: "Append and fsync one small WAL record; flush pages lazily" },
                { id: "flush", label: "Immediately write every dirty page to disk at commit" },
                { id: "skip", label: "Skip logging entirely — RAM is fast enough" },
              ],
              why: "The WAL turns twenty random page writes into one ordered log write; page flushes happen later in batches. Skipping the log makes the write fast but not durable.",
            },
          },
        ],
      },
    ],
  },

  /* ------------------------------------------------ Unit 2: Storage */
  {
    id: "storage",
    title: "Unit 2 · Storage & Disk I/O",
    tagline: "Rows, pages, and why disk reads dominate every query's cost.",
    category: "buffer",
    lessons: [
      {
        id: "rows-pages",
        title: "Rows live on Pages",
        minutes: 4,
        intro:
          "Databases don't read single rows from disk — they read fixed-size 8 KiB pages that hold dozens of rows at once.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Imagine a table of 100,000 customer rows. On disk, the database stores these as a file broken into chunks. Each chunk is a **page** — a fixed 8 KiB (8,192-byte) block. A page is the smallest unit of I/O the database knows: even if you only want one row, the storage engine loads the whole page that row sits on.\n\nThe math: a row of address data is roughly **128 bytes**. $8,192 ÷ 128 = 64$ rows fit on one page. A 100,000-row table therefore spans $⌈100,000 ÷ 64⌉ = 1,563$ pages.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Disk reads happen in blocks, not bytes. Doubling the row size halves the rows-per-page; doubling the row count doubles the pages. Page count = ceil(rows ÷ rows-per-page) — this single number predicts how long any table read will take.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "A table has 100,000 rows of 128 bytes. An 8 KiB page (8,192 bytes) holds 64 such rows. How many pages does the table span?",
              hint: "Compute ceil(100,000 ÷ 64).",
              answer: 1563,
              work: [
                "Rows per page = 8,192 bytes ÷ 128 bytes = 64",
                "Pages = ⌈100,000 ÷ 64⌉ = ⌈1,562.5⌉ = 1,563",
              ],
            },
          },
        ],
      },
      {
        id: "seq-scan-cost",
        title: "Sequential scans read everything",
        minutes: 5,
        intro:
          "When the database has no index to follow, it walks every page in order — cheap per page, brutal at scale.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A **sequential scan** starts at page 1 and reads forward to the last page. It cannot skip anything: a filter for `user_id = 42` is evaluated *after* a page is already in memory, one page at a time.\n\nA single page read costs roughly **0.1 ms** of I/O latency. Scanning a 20,000-row table means $⌈20,000 ÷ 64⌉ = 313$ page reads — about **31 ms**. Scaling to 500,000 rows pushes a scan past **780 ms**. That latency is why 'just run a query' is not free.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Sequential scan cost is proportional to the *table size*, never to how many rows the query returns. Reading one matching row out of 500k still costs ~7,813 page reads. To make lookups cost ~log(size) instead of size, the database needs an index — that's the next unit.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "A 20,000-row table (64 rows/page) is scanned end to end. How many pages are read?",
              hint: "ceil(20,000 ÷ 64).",
              answer: 313,
              work: [
                "Rows per page = 8,192 bytes ÷ 128 bytes = 64",
                "Pages = ⌈20,000 ÷ 64⌉ = ⌈312.5⌉ = 313",
                "I/O time = 313 reads × 0.1 ms ≈ 31.3 ms",
              ],
            },
          },
        ],
      },
      {
        id: "anchor-index-cost",
        title: "The anchor: what a point lookup costs",
        minutes: 5,
        intro:
          "One number anchors the whole index unit: a point lookup in a 200,000-row table reads about 3 pages.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A sequential scan of 200,000 orders reads $⌈200,000 ÷ 64⌉ = 3,125$ pages. A B-Tree index does better because each tree level is a single page that fans out to hundreds: at fan-out 512, one level reaches 512 keys and two levels reach $512² = 262,144$ keys — more than the entire table.\n\nAn indexed point lookup therefore walks 2 tree pages to the leaf and reads 1 data page: **3 page reads** instead of 3,125. Two versus three thousand. Commit that formula to muscle memory — the rest of the course keeps returning to it.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Point-lookup reads = ⌈log_fanout(rows)⌉ + 1. The +1 is the data page holding the row. At fan-out 512 that's ~3–4 reads for anything up to 134 million rows.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "orders has 200,000 rows. A B-Tree with fan-out 512 needs how many pages for a point lookup (tree levels + the final data page)?",
              hint: "512² = 262,144 already covers the table; then add the data page.",
              answer: 3,
              work: [
                "fan-out 512 → 1 level reaches 512 keys, 2 levels reach 512² = 262,144",
                "⌈log₅₁₂ 200,000⌉ = 2 tree levels",
                "2 tree pages + 1 data page = 3 page reads",
              ],
            },
          },
        ],
      },
      {
        id: "cache-hit-ratio-math",
        title: "Hit ratio, in raw numbers",
        minutes: 4,
        intro:
          "Cache hit ratio isn't a special metric — it's a subtraction problem, and the misses are the number that actually costs money.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Hit ratio = hits ÷ accesses. Over 120 page accesses at a 78% hit ratio, the cache serves $0.78 × 120 = 93.6 ≈ 94$ lookups from RAM; the remaining **26** go to disk.\n\nWhy the subtraction matters: the ratio is a percentage, but every miss costs a real 0.1 ms. $26 × 0.1 ms = 2.6$ ms is the whole latency story of that workload; the 94 hits contributed microseconds. Always convert a ratio back to miss *counts* before judging a cache.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "misses = accesses − hits; latency ≈ misses × disk latency. A 99% ratio over a million accesses is still 10,000 disk reads — quote miss counts, not percentages.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "120 page accesses at a 78% hit ratio — how many of them missed the pool and hit disk?",
              hint: "94 hit; the rest miss.",
              answer: 26,
              work: [
                "Hits = 0.78 × 120 = 93.6 → 94 hits",
                "Misses = 120 − 94 = 26 disk reads",
              ],
            },
          },
        ],
      },
      {
        id: "buffer-pool-intro",
        title: "The buffer pool keeps hot pages in RAM",
        minutes: 6,
        intro:
          "Disk is too slow for repeated reads, so the database caches pages in a buffer pool — a fixed number of in-memory frames.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "The **buffer pool** is a fixed-size set of frames, each able to hold one 8 KiB page. A working set that fits in the pool turns disk reads into memory reads; one that doesn't thrashes — fetching a page, evicting it, then fetching it again a moment later.\n\n**LRU** evicts the least-recently-used page. **Clock sweep** approximates LRU cheaply with a single reference bit per frame: a page whose bit is set gets a second chance before eviction.\n\nA service reading ~320 pages with a 75% hot working-set skew, on a 4-frame pool, misses 78% of the time. On 16 frames, the hot set fits and the hit ratio jumps past 70%.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A cache only helps when the working set fits. Frame count decides the miss rate more than the eviction policy does: LRU and Clock differ by a few %, but a too-small pool differs by tens of %. Watch the Buffer Pool lab to see the misses pile up.",
          },
          {
            kind: "task",
            task: {
              kind: "buffer",
              prompt:
                "Choose the pool that keeps disk reads under 120 on the thrashing workload (hit ratio ≥ 60%).",
              requires: [{ frames: 16, policy: "lru" }],
              maxReads: 120,
              minHitRatio: 0.6,
            },
          },
        ],
      },
      {
        id: "lru-vs-clock",
        title: "LRU vs Clock: sizing wins either way",
        minutes: 5,
        intro:
          "Two eviction policies, one lesson: at the same frame count they land within a few percent — the frame count is the real lever.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "**LRU** keeps a precise recency order: the least-recently-used page is evicted first. **Clock sweep** approximates it with one *reference bit* per frame — a pass of the hand clears bits, and a page whose bit was set rides again (its 'second chance'). Clock needs no recency structure, so cost-conscious hardware implementations choose it.\n\nRun the thrashing trace in the lab: at 4 frames both policies miss ~70%; at 16 frames both clear a 66%+ hit ratio. The policies disagree by single-digit percentages; the pool size disagrees by tens. Size first, then pick any sane policy.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Eviction policy tunes within a few percent at a fixed size; frame count moves tens of percent. The first question is always 'does the working set fit?' — the policy comes second.",
          },
          {
            kind: "task",
            task: {
              kind: "buffer",
              prompt:
                "Hold disk reads under 110 AND hit ratio ≥ 60% under BOTH LRU and Clock. Prove the point: 16 frames gives either policy headroom.",
              requires: [
                { frames: 16, policy: "lru" },
                { frames: 16, policy: "clock" },
              ],
              requiresAll: true,
              maxReads: 110,
              minHitRatio: 0.6,
            },
          },
        ],
      },
      {
        id: "dirty-pages-checkpoint",
        title: "Dirty pages and checkpoints",
        minutes: 5,
        intro:
          "The buffer pool holds changes the disk hasn't seen yet. That window is normal — until you need to shrink it.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A **dirty page** was modified in memory but not yet written to its disk block. The engine flushes dirty pages *lazily* — usually when the frame is evicted to make room, or at a **checkpoint**, a deliberate moment when every dirty page flushes and the current WAL position is recorded. A checkpoint bounds crash recovery: replay only what came after it.\n\nWhy not flush every dirty page at commit? Because that's twenty random writes per transaction. Delay + batch converts them into far calmer I/O bursts — with the WAL standing guard over the window in between.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Writes are deferred, never dropped. The WAL record must hit the log *before* its dirty page flushes — otherwise the disk block could outrun its own history. A checkpoint bounds how far recovery must replay.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Why doesn't the engine write every dirty page to disk at every commit?",
              answer: "batch",
              options: [
                { id: "batch", label: "It would turn one WAL write into many scattered random page writes per txn" },
                { id: "safe", label: "Writing dirty pages early is unsafe even with the WAL" },
                { id: "free", label: "Dirty pages never need to reach disk — RAM is durable" },
              ],
              why: "Committing to a single ordered WAL append is far cheaper than flushing scattered pages; dirty pages are deferred and batched into checkpoints while the WAL guarantees durability.",
            },
          },
        ],
      },
      {
        id: "seq-fast-but-filter-slow",
        title: "A fast scan is still a 100% scan",
        minutes: 4,
        intro:
          "Sequential I/O is the friendliest the disk ever is — yet a filter that scans reads every page, every time.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Reading pages in physical order is the *fastest* thing disk can do — no seeks, full bandwidth. That's why a sequential scan isn't a slow device; it's a strategy: read everything.\n\nTake the 500,000-row events table. A filter for one `user_id` still scans $⌈500,000 ÷ 64⌉ = 7,813$ pages (≈ **780 ms**) and keeps maybe 10 rows. Cheap pages, discarded rows. Scan cost answers 'how big is the table', never 'how many rows do you want'. That mismatch is exactly what an index fixes.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Sequential reads are fast; 100% of a table is still 100%. Filters without an index read sized by the table, not by the answer. The analyzer flags large-table seq scans for this accounting.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Sequential I/O is the fastest kind of disk access — so why is a 780 ms scan of 500,000 events still bad for a single-row filter?",
              answer: "everything",
              options: [
                { id: "everything", label: "It read all 7,813 pages to return a handful of rows" },
                { id: "fast", label: "It isn't bad — fast physical reads mean the query is cheap" },
                { id: "hdd", label: "It's only a problem on HDDs; SSDs make scans free" },
              ],
              why: "The strategy reads the whole table regardless of answer size; index-free filters scale with table size, not selectivity.",
            },
          },
        ],
      },
      {
        id: "bad-delete",
        title: "Write a DELETE that only touches what it should",
        minutes: 6,
        intro:
          "An unfiltered DELETE doesn't flag itself on row count — it flags on pages: every page read and every page rewritten.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`DELETE FROM orders` scans and then rewrites all $⌈200,000 ÷ 64⌉ = 3,125$ pages. Deleting one order should touch 3. The analyzer's UNFILTERED_DELETE warning is the engine spelling out that page bill.\n\nEvery DELETE is a SELECT plus a reclaim pass: the engine first *reads* the pages holding the rows, marks them dead, and later reclaims space. Filtering is what shrinks both sides. `DELETE FROM orders WHERE order_id = 42` uses the `order_id` index — 3 pages read, 3 rewritten, the rest of the table untouched.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Every write is a read first: pages touched = pages read + pages rewritten. An unfiltered DELETE is a full-table read and a full-table rewrite in disguise.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "Starting from the full-table DELETE below, write the same operation scoped to a single order so it reads and writes ~3 pages instead of ~3,125.",
              hint: "Add WHERE order_id = … — order_id is indexed.",
              vs: "DELETE FROM orders",
              defaultSql: "DELETE FROM orders\nWHERE order_id = 42",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["UNFILTERED_DELETE"],
              check: (a) =>
                a.statement === "DELETE" &&
                a.tables.some(
                  (t) => t.name === "orders" && t.filterColumns.includes("order_id"),
                ),
              why: "Filtering on order_id sends the DELETE down the index — 3 pages read and written, not the whole table.",
            },
          },
        ],
      },
      {
        id: "bad-update",
        title: "Write an UPDATE that doesn't replay every page",
        minutes: 6,
        intro:
          "An UPDATE without a WHERE is a full read plus a full rewrite — every page that holds a row gets dirtied.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`UPDATE products SET price = price * 1.1` bumps 5,000 products and touches $⌈5,000 ÷ 64⌉ = 79$ pages — the whole table. Add `WHERE sku = 'A-1'` and, because `sku` is indexed, the engine takes 3 pages to find and update one product.\n\nThe silent part: an UPDATE reads every page it touches (to bring rows into the pool) *and* dirties them (to write back later). The write tax scales with pages touched, exactly like a DELETE. A missing WHERE is a quiet full-table rewrite waiting for the next checkpoint.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Write cost = pages read + pages dirtied. An unfiltered UPDATE is the whole table on both sides. A narrow filter on an indexed column makes the write as small as the intent.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "The analyst's UPDATE below reprices every product. Scope it to a single product by SKU so it touches ~3 pages instead of ~79.",
              hint: "products has an index on sku. WHERE sku = 'A-1'.",
              vs: "UPDATE products SET price = price * 1.1",
              defaultSql: "UPDATE products\nSET price = price * 1.1\nWHERE sku = 'A-1'",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["UNFILTERED_UPDATE"],
              check: (a) =>
                a.statement === "UPDATE" &&
                a.tables.some(
                  (t) => t.name === "products" && t.filterColumns.includes("sku"),
                ),
              why: "Filtering on the indexed sku column limits the UPDATE to the row's 3 pages — the whole-table read and rewrite vanish.",
            },
          },
        ],
      },
      {
        id: "select-star-scope",
        title: "Scope what you SELECT",
        minutes: 5,
        intro:
          "SELECT * drags every column off every matching page — filter to fewer pages, project to fewer bytes.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Two levers shrink a read: the **filter** (which pages) and the **projection** (what leaves each page). `SELECT * FROM orders` fetches all 3,125 pages. `SELECT order_id, amount FROM orders WHERE customer_id = 7` descends the `customer_id` index to ~3 pages and carries two narrow columns per row.\n\nWhy projection matters on its own: a wide row means fewer rows per page, so `SELECT *` on a wide table drags more pages just to move fat rows — and it defeats covering indexes (next unit). The analyzer raises SELECT_STAR_ON_LARGE_TABLE precisely because the `*` abandons both knobs at once.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Filter shrinks pages touched; projection shrinks bytes per row and page. `*` gives up both knobs at once — name the columns you need.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "This dashboard query reads the whole orders table. Rewrite it to return only order_id and amount for one customer — using the customer_id index and dropping the star.",
              hint: "WHERE customer_id = 7 — it's indexed on orders.",
              vs: "SELECT * FROM orders",
              defaultSql: "SELECT order_id, amount\nFROM orders\nWHERE customer_id = 7",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["SEQUENTIAL_SCAN_ON_LARGE_TABLE", "SELECT_STAR_ON_LARGE_TABLE"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.tables.some(
                  (t) => t.name === "orders" && t.filterColumns.includes("customer_id"),
                ),
              why: "Filtering on the indexed customer_id, naming the columns, drops the reads from 3,125 pages to ~3.",
            },
          },
        ],
      },
      {
        id: "capstone-buffer",
        title: "Capstone · The Buffer Pool Thrash",
        minutes: 8,
        intro: "A real production incident that is fixed entirely by pool sizing.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Your OLTP service is swapping: the 4-frame pool can't keep the hot pages resident, so every access is a disk fetch — 78% misses. Diagnose the symptoms, then grow the pool (and pick an eviction policy) until the disk-read and latency budgets pass.",
          },
          {
            kind: "capstone",
            challengeId: "buffer_thrash",
            note: "Open the Buffer Pool lab, tune frame count and policy, and pass all assertions.",
          },
        ],
      },
    ],
  },

  /* ------------------------------------------------ Unit 3: Indexes */
  {
    id: "indexes",
    title: "Unit 3 · Indexes & B-Trees",
    tagline: "How B-Trees turn O(N) scans into O(log N) lookups.",
    category: "plan",
    lessons: [
      {
        id: "what-index",
        title: "What an index does",
        minutes: 4,
        intro:
          "An index is a separate structure that maps key values to their location — so the engine never has to scan the whole table.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Without an index, `WHERE user_id = 42` walks every page of the table. With one, the engine first probes a **B-Tree** keyed on `user_id`; the leaves point to the exact pages holding the matching rows. The table scan is replaced by a tree walk plus reading just the pages the answer lives on.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "An index is a trade: extra writes on every INSERT/UPDATE in exchange for fewer reads on filtered queries. It pays only when queries filter on the indexed column — an index on the wrong column is wasted space and wasted write time.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "A query filters one row out of a 500,000-row table. Which access method should a healthy query use?",
              answer: "index",
              options: [
                { id: "seq", label: "Sequential scan — read every page in order" },
                { id: "index", label: "B-Tree index lookup — walk the tree to the row's page" },
                { id: "copy", label: "Materialized copy — keep a duplicate table in RAM" },
              ],
              why: "A B-Tree lets the engine skip ~7,800 pages and touch only the ~4 that matter.",
            },
          },
        ],
      },
      {
        id: "btree-mechanics",
        title: "How a B-Tree stays shallow",
        minutes: 6,
        intro:
          "B-Tree nodes are pages. Each holds several keys, and when a page is full it splits — growing the tree in height only when the root splits.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A B-Tree page (the classic **degree 2** form) holds up to **3 keys** and 4 child pointers. On insert, a full page splits in the middle: the median key moves up to the parent, and the left and right halves become siblings. The only time the tree grows taller is when the **root** splits — so height grows logarithmically, not linearly.\n\nSearch walks from root to a leaf, comparing one key per level. With thousands of keys there are still only a handful of levels, so a lookup touches only that many pages plus one final data page.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Every B-Tree level is one page, and every page is one disk read. Fan-out (keys per page) is what keeps the tree shallow: reading a 3-level tree is 1 root + 1 level + 1 level + 1 data page ≈ 4 reads for a page-count worth of indexes.",
          },
          {
            kind: "task",
            task: {
              kind: "btree",
              prompt:
                "Insert 7 keys (50, 25, 75, 12, 37, 62, 88, in that order) into a degree-2 B-Tree. Verify it splits into 3 nodes with a single-key root.",
              keys: [50, 25, 75, 12, 37, 62, 88],
              order: 2,
              check: (s) =>
                s.nodeCount === 3 && s.height === 2 && s.rootKeys.length === 1 && s.keyCount === 7,
            },
          },
        ],
      },
      {
        id: "fanout-height-math",
        title: "Fan-out decides the height",
        minutes: 5,
        intro:
          "A million-row table is a 3-level tree when each page holds ~512 keys — height grows logarithmically, never linearly.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Each level of a B-Tree multiplies the number of reachable keys by the **fan-out** (keys per page). At 512:\n\n- level 1 → 512 keys,\n- level 2 → $512² = 262,144$,\n- level 3 → $512³ = 134,217,728$.\n\nA 1,000,000-row table therefore needs $⌈log₅₁₂(1,000,000)⌉ = 3$ levels, so a point lookup reads 3 tree pages plus 1 data page — 4 page reads. Crumple the fan-out to 40 and the same table needs 4 levels: the same rows, one extra page read every lookup. Width buys height.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "height ≈ ⌈log_fanout(rows)⌉, so lookup reads = height + 1. Height creeps up logarithmically with rows — doubling the table adds a fraction of a level — but jumps fast when fan-out shrinks.",
          },
          {
            kind: "task",
            task: {
              kind: "number",
              prompt:
                "A 1,000,000-row table is indexed with fan-out 512 per page. How many levels tall is the B-Tree?",
              hint: "512² = 262,144, 512³ = 134,217,728.",
              answer: 3,
              work: [
                "512¹ = 512, 512² = 262,144, 512³ = 134,217,728 keys reachable",
                "⌈log₅₁₂ 1,000,000⌉ = ⌈2.21⌉ = 3 levels",
              ],
            },
          },
        ],
      },
      {
        id: "btree-vs-scan",
        title: "O(log N) beats O(N)",
        minutes: 5,
        intro:
          "Time the two access paths side by side — the tree does a handful of hops where the scan does a read per page.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Scanning $N$ rows reads $N ÷ 64$ pages. A B-Tree lookup reads about $log_fanout(N) + 1$ pages. At 128 keys the contrast is already visible: the scan needs 2 pages, a tree needs ~3 hops; at 500,000 rows the scan needs 7,813 pages while a point lookup still fits in 4.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "This is the money chart of indexing: hop count scales with log(N) and stays flat forever, while sequential reads scale 1:1 with the table. The B-Tree playground draws both bars live so you can watch them diverge.",
          },
          {
            kind: "task",
            task: {
              kind: "btree",
              prompt:
                "Insert 128 sequential keys into a degree-2 B-Tree. A lookup must stay at 5 hops or fewer (vs ≥ 2 sequential page reads).",
              keys: Array.from({ length: 128 }, (_, i) => i + 1),
              order: 2,
              check: (s) => s.hops <= 5 && s.keyCount === 128,
            },
          },
        ],
      },
      {
        id: "index-write-tax",
        title: "The write tax of an index",
        minutes: 6,
        intro:
          "Indexes make reads cheap by making writes pricier — insert 80 keys and watch the tree already fold into 40 pages.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Every insert walks the tree to the right leaf, inserts the key, and — when the page is full — **splits**, writing a new page and updating its parent. That's the write tax: each index entry costs a few page writes amortized across the tree's balancing.\n\nProve it in the lab: insert keys 1..80 into a degree-2 B-Tree and inspect the result — 80 keys have become **40 pages**, only ~67% full. Half-used pages aren't a bug; they're the price of keeping the tree *searchable*. Compare with the heap table, where inserting 80 rows writes at most a couple of pages. Reads became $log(N)$; writes paid the bill.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Index write amplification = the extra pages an insert touches to keep the tree balanced. Fill factor is where that cost surfaces — lower fill means more pages and more headroom, not free space.",
          },
          {
            kind: "task",
            task: {
              kind: "btree",
              prompt:
                "Insert keys 1..80 into the degree-2 tree. Verify the index's true storage footprint: 80 keys — how many pages did the tree need?",
              keys: Array.from({ length: 80 }, (_, i) => i + 1),
              order: 2,
              check: (s) =>
                s.keyCount === 80 && s.nodeCount === 40 && s.height === 4,
            },
          },
        ],
      },
      {
        id: "when-index-hurts",
        title: "When an index hurts",
        minutes: 5,
        intro:
          "Indexes are not free wins — tiny tables, low-selectivity filters, and hot write workloads can make them net-negative.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Three cases where the planner (rightly) ignores an index:\n\n1. **Tiny table.** 5,000 rows fit in 79 pages — a sequential sweep is 79 reads; an index detour is tree hops plus scattered data pages. Scan wins.\n2. **Low selectivity.** Fetching 4,800 of 5,000 rows makes the index and data pages cover most of the table anyway — in *random* order. Sequential beats random hops.\n3. **Write-heavy workload.** Every insert pays the split/rewrite tax while queries never filter the indexed column.\n\nThe optimizer estimates row counts and picks the cheaper strategy; the analyzer mirrors it by reserving its large-table seq warning for genuinely big tables.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "An index is a bet on selectivity: it pays when few rows match among many. Low-selectivity filters and small tables make it dead weight — and every write still pays its tax.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "products has 5,000 rows (79 pages). A report returns 4,800 of them via WHERE in_stock = 1. Which access is cheaper?",
              answer: "scan",
              options: [
                { id: "scan", label: "Sequential scan — 79 sequential pages beats random hops for most of the table" },
                { id: "index", label: "Index on in_stock — index reads are always cheaper" },
                { id: "same", label: "Identical cost either way" },
              ],
              why: "At 96% selectivity the index fetches nearly every page anyway, in random order. Sequential reads of the small table win.",
            },
          },
        ],
      },
      {
        id: "composite-leading-column",
        title: "Composite indexes: the leading column decides",
        minutes: 5,
        intro:
          "An index on (a, b) helps WHERE a = ? and WHERE a = ? AND b = ? — but never WHERE b = ? alone.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A **composite index** sorts rows by the first column, then by the second within ties. The order *is* the contract of what can use it:\n\n- `WHERE customer_id = 7` → a run over everything with that customer — **served**.\n- `WHERE customer_id = 7 AND order_date …` → a sub-range inside it — **served**.\n- `WHERE order_date …` alone → the tree orders by customer first; the date defines no contiguous range — **scan**.\n\nSo the leading column is the one you filter on regardless; columns after it refine. `(a, b)` and `(b, a)` are different structures with different clients.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A composite index is one sort sequence. The leading column is the only one that stands alone; later columns only refine. Put the most selective, most-frequent filter first.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "You create an index on (customer_id, order_date). Which query CAN use it?",
              answer: "customer-led",
              options: [
                { id: "customer-led", label: "WHERE customer_id = 7 AND order_date BETWEEN '2026-01-01' AND '2026-01-31'" },
                { id: "date-led", label: "WHERE order_date = '2026-06-15' (no customer_id)" },
                { id: "both", label: "Both are equally servable" },
              ],
              why: "customer_id leads the sort, so that branch can be narrowed by order_date. A bare order_date filter cannot form a contiguous index range.",
            },
          },
        ],
      },
      {
        id: "covering-index",
        title: "Covering indexes: reads without the table",
        minutes: 6,
        intro:
          "If the index holds every column the query needs, the data pages are never touched — the tree alone answers.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A normal index lookup reads tree pages *and* the data page holding the row. If the index also carries the columns you SELECT — say `(id, sku)` — the leaf already has everything: the engine returns from the leaf and skips the data page. That's a **covering index**, roughly a 30% read cut, tree-only.\n\nThe trade: a bigger index and a heavier write tax (every insert updates the extra columns). And `SELECT *` silently kills covering — the missing column forces the data-page fetch. Projection choices in the SELECT clause are also index-design decisions.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Covering = the leaf satisfies the whole query. The analyzer's math models tree + data page; a covering index removes that final data page, keeping only the tree's own pages.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Query: SELECT sku FROM products WHERE id = 99, with an index on (id, sku). Compared to an index on id alone, what changes?",
              answer: "leaf",
              options: [
                { id: "leaf", label: "sku is in the leaf — the engine returns it without fetching the data row" },
                { id: "data", label: "It still must fetch products row 99's data page" },
                { id: "slower", label: "It's slower — the wider index needs more writes" },
              ],
              why: "A covering index serves the projection from its own leaves, eliminating the data-page read; the wider tree is the only cost.",
            },
          },
        ],
      },
      {
        id: "point-lookup-good",
        title: "Write a point lookup that uses the index",
        minutes: 6,
        intro:
          "Same table as the seq-scan lesson — different shape. Filter the indexed column and the reads collapse from thousands to 3.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`SELECT * FROM orders` costs 3,125 page reads. `SELECT order_id, amount FROM orders WHERE order_id = 99` costs ~3: two tree pages plus one data page. Same table, same data — only the WHERE used the index.\n\nWatch the meter in the lab: the before side sweeps every page, the good query descends the B-Tree and stops. mode = index, pages = ⌈log 200,000⌉ + 1. Every filtered query you write is a choice between those two numbers.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "seq → ~rows/64 pages; index → ~⌈log_fanout rows⌉ + 1 pages. The difference isn't the table — it's the access path, and the filter picks it.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "Turn the full-scan query into a point lookup that returns a single order's order_id and amount — through the order_id index.",
              hint: "SELECT order_id, amount FROM orders WHERE order_id = 99",
              vs: "SELECT * FROM orders",
              defaultSql: "SELECT order_id, amount\nFROM orders\nWHERE order_id = 99",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["SEQUENTIAL_SCAN_ON_LARGE_TABLE", "SELECT_STAR_ON_LARGE_TABLE"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.tables.some(
                  (t) => t.name === "orders" && t.filterColumns.includes("order_id"),
                ),
              why: "Filtering the indexed order_id routes the query through the B-Tree — 3 page reads instead of 3,125.",
            },
          },
        ],
      },
      {
        id: "cast-breaks-index",
        title: "Casting a column hides the index",
        minutes: 6,
        intro:
          "WHERE CAST(id AS TEXT) = '7' cannot use the index on id — the cast must run on every row before the comparison.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "The B-Tree stores typed `id` values in sorted order. `CAST(id AS TEXT) = '7'` asks the engine to compute a *function of the column* — something a sorted tree cannot walk to. The engine falls back to scanning every page and running the cast. The same is true of `LOWER(name)`, `DATE(created_at)`, and `col + 1`.\n\nThe escape hatch: cast the **constant**, not the column. `id = CAST('7' AS INTEGER)` keeps `id` bare, so the tree is usable. The analyzer raises EXPRESSION_ON_INDEXED_COLUMN and remodels the reads as a scan.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Keep the indexed column bare in WHERE: function-of-column = scan, function-of-constant = index. The tree stores values, not expressions.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "This query casts the indexed id and burns the index. Rewrite it so the index on events.id is used (and drop the star while you're at it).",
              hint: "WHERE id = 7 — leave the column bare.",
              vs: "SELECT * FROM events WHERE CAST(id AS TEXT) = '7'",
              defaultSql: "SELECT id, code\nFROM events\nWHERE id = 7",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["EXPRESSION_ON_INDEXED_COLUMN"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.tables.some(
                  (t) => t.name === "events" && t.filterColumns.includes("id"),
                ),
              why: "With id bare in WHERE, the tree does the work: 4 page reads instead of a 7,813-page scan.",
            },
          },
        ],
      },
      {
        id: "wildcard-breaks-index",
        title: "Leading wildcards defeat prefix scans",
        minutes: 6,
        intro:
          "LIKE 'doe%' is a range the tree can scan; LIKE '%doe%' matches anywhere and forces a full scan.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A B-Tree finds ranges because keys are sorted. 'doe%' is the range ['doe', 'dof') — the engine walks the tree to the first doe and reads until dof. That's an index service.\n\n'%doe%' can match at any position, so there's no contiguous range to walk: the engine reads every page and tests each row. Left-anchored LIKE is index-friendly; a leading wildcard is a scan. Real substring search needs a separate structure (say, trigram GIN), not a B-Tree mistreatment.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "LIKE 'prefix%' = a range; LIKE '%suffix%' = a scan. The analyzer flags LIKE_LEADING_WILDCARD — a leading wildcard tells the planner to read everything.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "This name search uses a leading wildcard and can't use any index. Rewrite it as an exact probe on an indexed column — products.sku — returning the matching product name.",
              hint: "SELECT name FROM products WHERE sku = 'A-1'",
              vs: "SELECT name FROM customers WHERE name LIKE '%doe%'",
              defaultSql: "SELECT name\nFROM products\nWHERE sku = 'A-1'",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["LIKE_LEADING_WILDCARD", "FILTER_MISSING_INDEX"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.tables.some(
                  (t) => t.name === "products" && t.filterColumns.includes("sku"),
                ),
              why: "An exact match on the indexed sku column is a 3-page point lookup — no wildcard, no table sweep.",
            },
          },
        ],
      },
      {
        id: "capstone-missing-index",
        title: "Capstone · The Missing Index",
        minutes: 8,
        intro: "A reporting lookup that scans 7,813 pages for a handful of rows.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "The operations dashboard filters the 500,000-row events table on `user_id` and times out. The plan shows a full sequential scan. Add the one missing structure and watch the reads collapse from 7813 pages to 4.",
          },
          {
            kind: "capstone",
            challengeId: "missing_index",
            note: "Open the Query Plan lab, create the B-Tree index, and match the reference result.",
          },
        ],
      },
    ],
  },

  /* ------------------------------------------------ Unit 4: Execution */
  {
    id: "execution",
    title: "Unit 4 · Query Execution & Writing SQL",
    tagline: "Read EXPLAIN plans, then write queries and read what they do to the database.",
    category: "plan",
    lessons: [
      {
        id: "read-plan",
        title: "Read your query plan",
        minutes: 5,
        intro:
          "Every SQL statement becomes an operator tree. The EXPLAIN plan shows it bottom-up: scans at the leaves, joins and sorts above.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "A plan is a DAG of operators. The leaf nodes are **scans** (which table, which filters), the middle nodes are **joins** (hash, nested loop, merge), and the top nodes are projections, sorts, and limits.\n\nThe first thing to check: what is the dominant scan doing? If a filter column has an index, the scan should say something other than a plain sequential scan of the whole table.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Operators are boxes that consume rows and emit rows; their cost is roughly (rows in) × (per-row work). A sequential scan has rows-in = table size. That's the number to hunt when a query is slow.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "The EXPLAIN plan shows `SEQ_SCAN events` filtering on `user_id` over a 500k-row table. What is true?",
              answer: "reads-all",
              options: [
                { id: "reads-all", label: "The engine read every page even though few rows match" },
                { id: "fine", label: "It's fine — the filter makes the scan cheap" },
                { id: "cached", label: "SEQ_SCAN only means the pages came from cache" },
              ],
              why: "A sequential scan reads the whole table before the filter runs; a filter alone never skips pages.",
            },
          },
        ],
      },
      {
        id: "plan-shape-bottom-up",
        title: "Plans read bottom-up",
        minutes: 5,
        intro:
          "A plan is a tree: scans at the leaves, joins above, final touches at the root. Read it from the leaves — that's where reads get billed.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "EXPLAIN prints operators with the outermost (usually the projection or aggregate) at the top and the **scan** leaves at the bottom. Rows flow upward: leaves produce rows, joins combine streams, the root consumes.\n\nWhy read from the bottom? Because disk I/O happens at the leaves — the scans choose the pages. Everything above transforms rows already in memory. When a plan surprises you (a hash join where you expected a nested loop), the story is in the row counts the engine estimated, not in magic.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Leaves = tables and page costs; middle = joins that blow up or narrow row counts; root = the answer. The bill is paid at the leaves.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Why do we read EXPLAIN plans from the leaves upward?",
              answer: "flow",
              options: [
                { id: "flow", label: "Rows flow leaves → join → root, and the disk reads happen at the leaves" },
                { id: "top", label: "The root operator is the only one that matters" },
                { id: "order", label: "The bottom is always the cheapest operator, so start there" },
              ],
              why: "The scan leaves decide which pages get read; joins and the root transform rows already in memory.",
            },
          },
        ],
      },
      {
        id: "hash-vs-nested-loop",
        title: "Hash join vs nested loop",
        minutes: 6,
        intro:
          "Two tables become one row stream two ways — the choice is really a row-count and index story.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "**Nested loop**: for each outer row, probe the inner side (ideally by index). Cost ≈ outer rows × inner lookup. Great when the inner is selective per outer row.\n\n**Hash join**: build a hash table over the smaller side, then probe it once per row of the larger. Cost ≈ outer + inner (one pass each), no index required — but equality predicates only. **Merge join**: both sides already sorted, walk them in lockstep.\n\nJoining orders (200k) to customers (20k) on an equality key, the engine usually builds-and-probes — a hash join. Read a plan's join type as a note on how reads combine: multiply (loop) or add (hash/merge).",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Nested loop = O(outer × inner) per-row probes; hash join = one pass each side; merge = two sorted walks. The join type in a plan encodes which cost model held.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "orders (200k) JOIN customers (20k) on an equality key, customers.id indexed. Which join should the engine prefer for the read bill?",
              answer: "hash",
              options: [
                { id: "hash", label: "Hash join — build the small side once, probe the big side once" },
                { id: "loop", label: "Nested loop is always the default for any equality join" },
                { id: "merge", label: "Merge join — it needs a full sort of both sides first" },
              ],
              why: "Hash join reads each input once and probes in memory; nested loop would multiply; merge needs sorted inputs the query doesn't create.",
            },
          },
        ],
      },
      {
        id: "sort-spill-memory",
        title: "Sorts and memory spills",
        minutes: 6,
        intro:
          "Sorting a result larger than the sort buffer spills partial runs to disk — and the plan reports it as a disk-spill tag.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "ORDER BY, DISTINCT, and GROUP BY can all sort. The sort runs in a bounded buffer (sort_mem / work_mem); when the input exceeds it, the engine writes sorted **runs** to disk and then merges them — an *external* sort. Each spilled byte is I/O paid twice (written, then re-read), and the plan shows a DISK_SPILL marker.\n\nThe best fix is upstream: fewer rows into the sort (filters), narrower projections, or an index that already returns keys in order. Raising sort memory helps a little; shrinking the sorted set helps a lot.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A spill is the sort paid twice: write the runs, read them back. When a plan tags DISK_SPILL, shrink the input — memory knobs are the second lever, not the first.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Why is a sort spilling to disk worse than the same sort that fits in memory?",
              answer: "twice",
              options: [
                { id: "twice", label: "The intermediate runs must be written to disk and then read back" },
                { id: "cpu", label: "Disk sorts use an inferior comparison algorithm" },
                { id: "index", label: "The engine must build a B-Tree for every row" },
              ],
              why: "External sort pays I/O both for writing each run and for reading them back during the merge — the sort's cost roughly doubles.",
            },
          },
        ],
      },
      {
        id: "limit-stops-early",
        title: "LIMIT can stop the pipeline early",
        minutes: 5,
        intro:
          "LIMIT isn't just pagination — it's a license for the engine to stop reading once enough rows are out.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`SELECT … WHERE user_id = 7 ORDER BY event_time DESC LIMIT 10` — with an index on (user_id, event_time), the engine walks the matching branch in order and **stops after 10 rows**. That can be 3–4 page reads instead of resolving every match.\n\nBut LIMIT can't always push down: above an aggregate or a sort, the whole input must be processed before the limit applies — the plan shows whether the stop reached the scan or not.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "LIMIT + ORDER BY the index can serve = stop-early reads. LIMIT over an aggregate/sort = still read everything, discard late. The plan tells you which.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "With an index on (user_id, event_time), what does LIMIT 10 in the query above actually buy?",
              answer: "stop",
              options: [
                { id: "stop", label: "The engine reads the matching branch in order and stops after 10 rows" },
                { id: "full", label: "Nothing — the whole scan always runs before LIMIT" },
                { id: "display", label: "It only trims what gets sent to the browser" },
              ],
              why: "The index returns matches in the requested order, so the scan can halt once 10 rows are out — reads scale with the answer, not the match set.",
            },
          },
        ],
      },
      {
        id: "seq-scan-ok-small",
        title: "When a sequential scan is the right plan",
        minutes: 5,
        intro:
          "Not every SEQ_SCAN is an emergency — small tables and low-selectivity filters are legitimately scanned.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Scanning customers (20,000 rows, 313 pages) to build a full report is ~31 ms of clean sequential I/O — perfectly healthy. Scanning 500,000 events to return one user's row is ~780 ms for the same physical pattern, but the *selectivity* story is different.\n\nThe analyzer only raises SEQUENTIAL_SCAN_ON_LARGE_TABLE when the table is big (≥200k rows); small sweeps pass silently because they're cheap by construction. The skill isn't 'never see a scan' — it's judging size × selectivity before worrying.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Sequential scans aren't bugs; unnecessary full sweeps of big tables are. Size sets the floor, selectivity decides whether an index earns its keep.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Which of these sequential scans is completely fine?",
              answer: "report",
              options: [
                { id: "report", label: "Scanning all 20,000 customers for a full monthly report" },
                { id: "single", label: "Scanning all 500,000 events to find one user_id = 42" },
                { id: "both", label: "Both are equally acceptable" },
              ],
              why: "A 313-page sweep is ~31 ms and returns the whole table — small and matches intent. The second case scans 7,813 pages for a handful of rows.",
            },
          },
        ],
      },
      {
        id: "write-select",
        title: "Write your first point lookup",
        minutes: 6,
        intro:
          "Type a real WHERE query and read what the engine actually does — which table, which pages, at what cost.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Lookup of a single event by `user_id`: `SELECT id, code FROM events WHERE user_id = 42`. Write it in the editor and check it.\n\nThe database does not guess — it reads the plan. `user_id` has **no index** in this lesson's catalog, so the engine must sequentially scan all 500,000 rows (7,813 pages at 0.1 ms ≈ 780 ms) and drop every non-matching row after the fact. The query is 'correct' but expensive.\n\nThe next lesson shows the alternative: a JOIN that reads each table once, plus an index lesson that turns this scan into 4 pages.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A filter without an index is a post-scan filter: read everything, then keep some. The page count equals the table size, not the answer size. Memorize the shape — `SEQ_SCAN` + `WHERE` + no index = scan-then-drop.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "Write a query that fetches `id` and `code` for `user_id = 42` from the `events` table. (No index exists on user_id — the point is to see the seq-scan cost.)",
              hint: "SELECT … FROM events WHERE user_id = 42",
              defaultSql: "SELECT id, code\nFROM events\nWHERE user_id = 42",
              catalog: LESSON_SQL_CATALOG,
              check: (a) =>
                a.statement === "SELECT" &&
                a.tables.some(
                  (t) => t.name === "events" && t.filterColumns.includes("user_id"),
                ),
              why: "Correct intent — the engine scans events on user_id. The analyzer shows the scan-then-filter cost because user_id has no index (that is exactly what the Missing Index capstone fixes).",
            },
          },
        ],
      },
      {
        id: "narrow-your-read",
        title: "Filter then project: narrow your read",
        minutes: 6,
        intro:
          "The cheapest query is the one that reads the least — a WHERE on the indexed column plus only the columns you need.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`SELECT id, code FROM events` reads all 7,813 pages. Add `WHERE id = 42` and the tree answers from ~4 pages. Narrowing has two orders of operation: the **filter** picks which pages enter the pool, the **projection** decides how many bytes leave each page.\n\nGood habits compound: the filter leans on the index, the projection drops fat columns, and a later covering index makes both cheaper still. When you read an analyzer readout, ask which of your clauses moved the number — the WHERE moved it here.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "WHERE = pages fetched; projection = bytes per page; ORDER + LIMIT = how much finishes. Clause by clause, the WHERE on an indexed column is worth ~1,000×.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "The analytics query reads the whole events table. Narrow it to one event by id — using the events.id index.",
              hint: "WHERE id = 42",
              vs: "SELECT id, code FROM events",
              defaultSql: "SELECT id, code\nFROM events\nWHERE id = 42",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["SEQUENTIAL_SCAN_ON_LARGE_TABLE"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.tables.some(
                  (t) => t.name === "events" && t.filterColumns.includes("id"),
                ),
              why: "Filtering events.id descends the index — 4 page reads instead of 7,813.",
            },
          },
        ],
      },
      {
        id: "in-vs-join",
        title: "IN subqueries can act like N+1",
        minutes: 7,
        intro:
          "A correlated IN re-probes its inner data once per outer row — a JOIN hoists that work out of the loop.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`WHERE e.user_id IN (SELECT c.id FROM customers c WHERE c.id = e.user_id)` looks tidy, but the inner query references the outer row (`e.user_id`), so the engine executes it *per outer row*: a correlated subquery — the N+1 pattern, wearing IN syntax.\n\nRewriting as `FROM events e JOIN customers c ON c.id = e.user_id` lets the planner scan events once and probe the customers index inline, so reads stop multiplying against the outer row count. (events.user_id is unindexed here — that side still scans; that's the Missing Index capstone's job. The N+1 is a separate sin.)",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "A correlated subquery in WHERE, IN, or the SELECT list = N+1. A JOIN = each side read inline. The analyzer raises N_PLUS_ONE and keeps the reads per-table instead of per-outer-row.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "Turn this correlated IN into a JOIN that reads events once and customers via its index — same result, no per-row probing.",
              hint: "FROM events e JOIN customers c ON c.id = e.user_id",
              vs: "SELECT e.id FROM events e WHERE e.user_id IN (SELECT c.id FROM customers c WHERE c.id = e.user_id)",
              defaultSql:
                "SELECT e.id, e.code\nFROM events e\nJOIN customers c ON c.id = e.user_id",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["N_PLUS_ONE"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.joinPairs.length > 0 &&
                !a.correlated &&
                a.tables.some((t) => t.name === "events") &&
                a.tables.some((t) => t.name === "customers"),
              why: "A JOIN replaces per-row inner probes with one pass per table: reads add instead of multiplying by the outer count.",
            },
          },
        ],
      },
      {
        id: "explicit-join-keys",
        title: "State the join keys explicitly",
        minutes: 6,
        intro:
          "Comma-joins bury the join condition inside WHERE. Writing JOIN … ON makes intent, indexes, and plans readable.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`FROM orders o, customers c WHERE c.id = o.customer_id` returns the same rows as a JOIN — but the condition hides in the WHERE, mixed with filters, and a missing predicate quietly becomes an enormous cartesian product.\n\n`FROM orders o JOIN customers c ON c.id = o.customer_id` separates wiring from filtering: ON owns the join keys, WHERE owns row selection. The analyzer counts explicit join pairs, the plan reads more obviously, and future readers see which columns actually mesh the tables. Also: name the columns you want instead of `o.*` / `*`.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "ON = how tables combine; WHERE = which rows survive. Explicit keys keep plans predictable and let index design follow the join shape.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "This comma-join buries its predicate and selects everything. Rewrite it as an explicit JOIN...ON with only the columns you need.",
              hint: "JOIN customers c ON c.id = o.customer_id",
              vs: "SELECT * FROM orders o, customers c",
              defaultSql:
                "SELECT o.order_id, o.amount, c.name\nFROM orders o\nJOIN customers c ON c.id = o.customer_id",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["SELECT_STAR_ON_LARGE_TABLE"],
              check: (a) =>
                a.statement === "SELECT" &&
                a.joinPairs.length > 0 &&
                !a.correlated &&
                a.tables.some((t) => t.name === "orders") &&
                a.tables.some((t) => t.name === "customers"),
              why: "An explicit JOIN...ON gives the planner (and the analyzer) a real join pair and a narrow projection: predictable reads, readable query.",
            },
          },
        ],
      },
      {
        id: "write-join",
        title: "Write a JOIN that reads each table once",
        minutes: 7,
        intro:
          "Replace an N+1 correlated lookup with a JOIN and feel the reads collapse from ×N to +1.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "The bug: `SELECT (SELECT name FROM customers c WHERE c.id = o.customer_id) AS name FROM orders o` fires **one inner lookup per order row**. With 200,000 orders, every row re-reads `customers`.\n\nFix: let the engine do one **JOIN** and stream both tables together: `FROM orders o JOIN customers c ON c.id = o.customer_id`. `customers.id` is indexed, so the join probes it directly. Reads become *orders scanned once* + *customers probed via index* — adding, not multiplying.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Correlated subqueries are reads-per-row (N+1); a JOIN on an indexed key is reads-per-table. When the analyzer reports `N_PLUS_ONE` on your query, you are paying outer_rows × inner_pages instead of outer_pages + inner_pages.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "Rewrite this as a JOIN that returns `order_id`, `amount`, and the customer `name` — reading customers via its indexed `id`, not per row: `SELECT o.order_id, o.amount, (SELECT c.name FROM customers c WHERE c.id = o.customer_id) AS name FROM orders o`",
              hint: "Use JOIN … ON c.id = o.customer_id and drop the subquery.",
              defaultSql:
                "SELECT o.order_id, o.amount, (SELECT c.name FROM customers c WHERE c.id = o.customer_id) AS name\nFROM orders o",
              catalog: LESSON_SQL_CATALOG,
              check: (a) =>
                a.statement === "SELECT" &&
                a.joinPairs.length > 0 &&
                !a.correlated &&
                a.tables.some((t) => t.name === "orders") &&
                a.tables.some((t) => t.name === "customers"),
              why: "A JOIN on `c.id = o.customer_id` scans orders and index-seeks customers — no `N_PLUS_ONE` warning, reads add instead of multiply.",
            },
          },
        ],
      },
      {
        id: "nplusone",
        title: "The N+1 trap",
        minutes: 6,
        intro:
          "Fetching one lookup per row — say a SELECT inside a loop — turns a cheap join into O(outer × inner).",
        blocks: [
          {
            kind: "prose",
            markdown:
              "An ORM that reads 10,000 transaction rows and then runs 'SELECT name FROM users WHERE id = ?' for each one triggers **10,000 separate inner reads**. Each inner read scans the 2,000-row users table (~32 pages), so the loop costs $10,000 × 32 = 320,000$ page reads.\n\nA single `JOIN` reads `txns` once (157 pages) and `users` once (32 pages): about **189 pages total**. The fix changes the cost from multiply to add.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "N+1 is a correlation-count bug: one extra I/O per row vs one per table. Any time a query plan shows 'read the small table again for every outer row', replace it with a JOIN — the engine then reads each input once and streams them together.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "In the loop above (10k txns, 32 pages per inner scan), why is the ORM version so much slower than a JOIN?",
              answer: "per-row",
              options: [
                { id: "per-row", label: "It does a full inner scan once per row → reads × 10,000" },
                { id: "per-table", label: "It reads each table once, like a JOIN" },
                { id: "no-io", label: "ORMs don't read from disk" },
              ],
              why: "Correlated lookups multiply inner-pages by outer-rows; a JOIN adds them.",
            },
          },
        ],
      },
      {
        id: "archive-with-where",
        title: "Archive with a WHERE, not a sweep",
        minutes: 6,
        intro:
          "An archiving batch meant to touch a few rows still reads and rewrites the whole table if its UPDATE has no WHERE.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "`UPDATE payments SET status = 'archived'` flags 150,000 rows and touches $⌈150,000 ÷ 64⌉ = 2,344$ pages on both sides of the write. Scoping one account — `WHERE account_id = 42`, indexed — costs ~3 pages.\n\nThis is the quiet hazard: an UPDATE/DELETE without a WHERE is *both* a full read and a full rewrite queued for checkpoints. Real archivers chunk their work into bounded WHERE batches; a narrow, occasional update is the write equivalent of a point lookup.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Write queries are read queries that then dirty pages. An unfiltered UPDATE is a silent full-table rewrite; a scoped one is a point write.",
          },
          {
            kind: "task",
            task: {
              kind: "sql",
              prompt:
                "The archiving batch below sweeps every payment. Scope it to one account via its indexed column so it writes ~3 pages, not 2,344.",
              hint: "WHERE account_id = 42 — index on account_id.",
              vs: "UPDATE payments SET status = 'archived'",
              defaultSql: "UPDATE payments\nSET status = 'archived'\nWHERE account_id = 42",
              catalog: LESSON_SQL_CATALOG,
              mustAvoid: ["UNFILTERED_UPDATE"],
              check: (a) =>
                a.statement === "UPDATE" &&
                a.tables.some(
                  (t) => t.name === "payments" && t.filterColumns.includes("account_id"),
                ),
              why: "account_id is indexed, so the archiving UPDATE reads and dirties 3 pages instead of sweeping and rewriting all 2,344.",
            },
          },
        ],
      },
      {
        id: "capstone-nplusone",
        title: "Capstone · The N+1 Query Disaster",
        minutes: 8,
        intro: "A 320,000-read report loop that should be a ~189-read join.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "The analytics report runs a correlated subquery per transaction row. Replace it with a JOIN that matches the reference result, and the page reads drop from 320,000 to under 500.",
          },
          {
            kind: "capstone",
            challengeId: "n_plus_one",
            note: "Open the Query Plan lab, rewrite the query, and pass the read + time budgets.",
          },
        ],
      },
    ],
  },

  /* ------------------------------------------------ Unit 5: Transactions */
  {
    id: "transactions",
    title: "Unit 5 · Transactions & Isolation",
    tagline: "Locks, isolation levels, and the four anomalies they block.",
    category: "concurrency",
    lessons: [
      {
        id: "shared-vs-exclusive",
        title: "Shared locks share; exclusive locks exclude",
        minutes: 6,
        intro:
          "S locks let readers read together; X locks claim a row for one writer. The compatibility matrix is the whole story.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Two **shared (S)** locks coexist — readers never block readers. A shared request conflicts with an **exclusive (X)** lock, and with another exclusive: writers block everyone, including each other.\n\n`SELECT` takes S (usually); `UPDATE`, `DELETE`, and `INSERT` need X. When a transaction requests a lock that collides with a grant, it **waits** in the resource's queue. That matrix — S+S ok, S+X no, X+X no — plus the lock *lifetime* is the complete machinery behind every isolation level.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Lock modes are compatibility domains: readers concurrent, writers serial. A stalled transaction is almost always stalled by a conflicting mode, not by latency.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Txn A holds a shared lock on row 1. Txn B needs an exclusive lock on the same row. What happens to B?",
              answer: "wait",
              options: [
                { id: "wait", label: "B waits — X conflicts with A's S until A's read is done/committed" },
                { id: "proceed", label: "B proceeds anyway — shared locks never block writers" },
                { id: "downgrade", label: "B downgrades to a shared lock and writes anyway" },
              ],
              why: "X conflicts with any S grant (and any X): B parks in the wait queue until A's S releases.",
            },
          },
        ],
      },
      {
        id: "lock-queue-fifo",
        title: "Lock queues are FIFO",
        minutes: 5,
        intro:
          "A contended resource gathers a queue of waiters, and when the grant frees, the head of the line is served — order is the contract.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Each resource has a grant plus a **wait queue**. Txn A holds X on row 1; txns B, C, D request S on it. They line up in arrival order: when A commits and the lock frees, B is granted; C and D ride up the line. FIFO plus deadlock detection is what makes waiters fair and progress predictable.\n\nThe Isolation lab draws this: who holds, the queue order, and the dashed wait onto each waiting lane until a release grants the head.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Waiters are a queue, not a scrum: FIFO, head first. When a txn 'sits', ask who holds the lock and who is ahead of it in line.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Txn A holds an exclusive lock on row 1. Txns B, C, D request shared locks, in that order. When A commits, who is granted first?",
              answer: "b",
              options: [
                { id: "b", label: "B — it's at the head of the FIFO wait queue" },
                { id: "d", label: "D — it arrived last, so it should win" },
                { id: "all", label: "All three at once — S locks are compatible" },
              ],
              why: "The queue is FIFO: the first waiter (B) gets the grant when the conflicting X frees.",
            },
          },
        ],
      },
      {
        id: "locks-isolation",
        title: "Locks, and what isolation levels guard",
        minutes: 6,
        intro:
          "Locks serialize conflicting operations. The isolation level decides how long a read's lock is held — and which anomalies slip through.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Transactions take **shared (S)** locks to read and **exclusive (X)** locks to write. Two S locks coexist; S and X (or X and X) conflict, so the later one **waits**.\n\nThe isolation level describes the lifetime of a read lock, from weakest to strongest:\n\n- **READ UNCOMMITTED** takes no read lock at all — a reader can see uncommitted writes (**dirty reads**).\n- **READ COMMITTED** holds S only during the read — two reads of the same row can disagree (**non-repeatable reads**).\n- **REPEATABLE READ** holds S until COMMIT — but a new row inserted by another txn can still appear mid-scan (**phantom reads**).\n- **SERIALIZABLE** locks key ranges too, so even phantom rows are blocked.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Isolation strength is just lock lifetime. Fewer held locks = more concurrency = weaker guarantees. Pick the weakest level that still meets the requirement: most apps want READ COMMITTED, finance wants SERIALIZABLE.",
          },
          {
            kind: "task",
            task: {
              kind: "isolation",
              prompt:
                "Txn A writes −100 to an account but hasn't committed. Which isolation level(s) keep txn B from seeing the uncommitted 400?",
              requires: ["read_committed", "repeatable_read", "serializable"],
              scenario: "dirty_read",
            },
          },
        ],
      },
      {
        id: "dirty-read-anomaly",
        title: "Watch a dirty read form — and vanish",
        minutes: 7,
        intro:
          "Replay the dirty_read scenario and flip isolation levels: READ UNCOMMITTED leaks in-flight writes; READ COMMITTED and up don't.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Run the dirty-read script in the lab: txn A begins, writes balance 500 → 400 (uncommitted), and txn B reads the same row.\n\nUnder **READ UNCOMMITTED**, B's SELECT takes no lock and sees A's in-flight 400 — a dirty read. Under **READ COMMITTED** and above, B's shared read blocks until A commits, so B reads 500. One script, one difference: whether a reader's lock (or its absence) stands between B and A's uncommitted value.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Dirty = reading a write that hasn't committed. Isolation decides when a reader's lock blocks other writers' X locks. RC and up stop dirty reads; RU skips the lock entirely.",
          },
          {
            kind: "task",
            task: {
              kind: "isolation",
              prompt:
                "Choose an isolation level that keeps txn B from ever seeing txn A's uncommitted 400 — the dirty read must be gone in the timeline.",
              requires: ["read_committed", "repeatable_read", "serializable"],
              scenario: "dirty_read",
            },
          },
        ],
      },
      {
        id: "non-repeatable-anomaly",
        title: "Two reads can disagree in READ COMMITTED",
        minutes: 7,
        intro:
          "A deposit lands between your reads — the same row, different balances. Only held read locks make it impossible.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Under READ COMMITTED, txn B reads balance 500, txn A deposits +100 and commits, and B reads *again*: 600. B's two reads of the same row disagreed — a **non-repeatable read** — because RC released B's shared lock the moment each read finished.\n\nReplay the non_repeatable script under REPEATABLE READ: B's shared lock now lives until COMMIT, so A's write parks behind it and B sees 500, then 500. Same statements, different lock lifetime, different transcript.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Non-repeatable = a row changed between two reads in one txn. RC drops S after each read; RR holds S to commit. The anomaly is about lock *lifetime*, not row deletes.",
          },
          {
            kind: "task",
            task: {
              kind: "isolation",
              prompt:
                "Pick the level where txn B's two reads both return 500 — the non-repeatable read must be gone.",
              requires: ["repeatable_read", "serializable"],
              scenario: "non_repeatable",
            },
          },
        ],
      },
      {
        id: "phantom-ranges",
        title: "Repeating reads, phantom rows",
        minutes: 6,
        intro:
          "Some anomalies are about a single row; others are about rows that appear between scans.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "**Non-repeatable read**: txn B reads balance 500, txn A deposits +100 and commits, B reads *again* and sees 600. REPEATABLE READ holds B's shared lock, so A's write waits until B commits — both B reads stay 500.\n\n**Phantom read**: B scans rows 1..99 (5 rows), A inserts row 6 and commits, B scans again and sees 6 rows. Only SERIALIZABLE locks the *range*, so A's INSERT blocks — B's second scan still matches 5 rows.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Row locks can't stop new rows from appearing — that's a job for predicate/range locks. Phantom prevention costs the most concurrency, which is why it's the top level.",
          },
          {
            kind: "task",
            task: {
              kind: "isolation",
              prompt:
                "A second scan in the same transaction sees a row that a concurrent INSERT committed. Which isolation level prevents this phantom read?",
              requires: ["serializable"],
              scenario: "phantom",
            },
          },
        ],
      },
      {
        id: "range-lock-cost",
        title: "Range locks cost the most concurrency",
        minutes: 5,
        intro:
          "Stopping phantom rows means locking a range, not a row — and a loose range is a heavy hammer.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "SERIALIZABLE adds **predicate/range locks**: a `SELECT ... WHERE account_id = 7` grabs the gap around that key, and a concurrent INSERT matching it parks until the reader commits. The phantom becomes impossible — at a price.\n\nHow much concurrency? Exactly how wide the predicate. A tight equality parks a narrow key gap; an unindexed range filter can lock a whole table's worth of gaps and serialize unrelated writers. RR held row locks; SERIALIZABLE holds key-space itself. It's the strongest guarantee and the least concurrent read — use it only where the requirement truly demands it.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Phantom safety = range locking = reduced concurrency. A narrow predicate parks few neighbors; a wide one serializes everyone. Choose the weakest guarantee that satisfies the business rule.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Why is SERIALIZABLE more expensive for concurrency than REPEATABLE READ on the same workload?",
              answer: "range",
              options: [
                { id: "range", label: "It locks key ranges (and parks matching INSERTs), not just rows" },
                { id: "cpu", label: "SERIALIZABLE sessions use more CPU per statement" },
                { id: "rows", label: "It takes wider row locks on every table" },
              ],
              why: "Adding predicate/range locks to close the phantom gap means waiting writers for the whole key span the reader touched, not just its rows.",
            },
          },
        ],
      },
      {
        id: "isolation-ladder-choice",
        title: "Pick the weakest level that works",
        minutes: 5,
        intro:
          "RU → RC → RR → SERIALIZABLE is a concurrency price ladder. Climb as far as the guarantee demands — no further.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Each rung costs more concurrency:\n\n- **READ UNCOMMITTED**: no read locks — dirty reads. Fast, analytics-tolerant.\n- **READ COMMITTED**: S during each read — no dirty reads. The workhorse default.\n- **REPEATABLE READ**: S to commit — no non-repeatable reads.\n- **SERIALIZABLE**: +range locks — no phantoms.\n\nThe lab re-runs the *same* script at every level, so the cost shows up as blocked acquisitions, not theory. Rule of thumb: a dashboard may legitimately run RU/RC; a banking read-modify-write wants RC/RR; an inventory system under-counting stock wants SERIALIZABLE. Choose the guarantee the business rule states — nothing stronger.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Concurrency cost ≈ lock lifetime. The weakest level whose guarantee satisfies the requirement is the cheapest correct one — stronger only looks safer.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "A billing read must never see a write that later aborts, but two reads inside one transaction may differ. Which level fits?",
              answer: "rc",
              options: [
                { id: "rc", label: "READ COMMITTED — blocks dirty reads, permits non-repeatable reads" },
                { id: "rr", label: "REPEATABLE READ — and accept lock cost it doesn't need" },
                { id: "ru", label: "READ UNCOMMITTED — no dirty-read protection at all" },
              ],
              why: "The stated contract forbids dirty reads but tolerates drift between reads — that's exactly READ COMMITTED, the cheaper rung.",
            },
          },
        ],
      },
      {
        id: "deadlock-order",
        title: "Deadlocks and lock ordering",
        minutes: 6,
        intro:
          "Two transactions that take locks in opposite orders can wait on each other forever — until the engine picks a victim.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Txn A locks row 1, then wants row 2. Txn B locks row 2, then wants row 1. Each holds what the other needs: a **cycle** in the Wait-For graph — a deadlock.\n\nThe engine detects the cycle and aborts one transaction (the victim), rolling back its uncommitted work so the other can finish. The real fix is at the application layer: a **global lock order** (e.g. always lock the lowest row id first) makes cycles impossible.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Deadlock = cycle in the Wait-For graph. Impose one ordering over all lock acquisitions and the graph can never loop: whoever acquires the first (lowest) resource first is guaranteed to be alone on the second.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Two transactions update the same two rows in opposite orders and end up waiting on each other. What prevents that cycle from forming?",
              answer: "order",
              options: [
                { id: "order", label: "Give every transaction one global lock ordering (e.g. always smallest row id first)" },
                { id: "faster", label: "Make the database acquire locks faster" },
                { id: "shared", label: "Use shared locks for all writes so nothing blocks" },
              ],
              why: "A globally consistent lock order means only one transaction can ever be first on the shared row — no wait-for cycle can form.",
            },
          },
        ],
      },
      {
        id: "deadlock-wait-for-graph",
        title: "Spot the cycle in the Wait-For graph",
        minutes: 5,
        intro:
          "A Wait-For edge says 'this txn waits on a lock that txn holds'. Edges looping back on themselves are the deadlock.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Nodes are transactions; an edge points from the party waiting to the one holding what it needs. Plain waits are trees — someone eventually gets served. But when edges form a **cycle**, every member waits on another, so none can progress. That's the deadlock.\n\nThe engine detects the cycle and aborts a **victim** — typically the requester whose edge closed the loop — rolling back its uncommitted writes so the survivors finish. The lab paints the cycle in red and records the victim's ABORT. Spotting clues reads like error handling: a wait isn't a bug; a loop is.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Cycle = deadlock, wait = fine. When a txn dies at the orchestrator's hands, the Wait-For cycle named the reason, and a consistent lock order would have prevented it.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "Txn A holds row 1 and wants row 2; txn B holds row 2 and wants row 1. What does the Wait-For graph show?",
              answer: "cycle",
              options: [
                { id: "cycle", label: "A cycle: A waits on B and B waits on A — a deadlock" },
                { id: "wait", label: "Just two ordinary waits that will both eventually resolve" },
                { id: "none", label: "No edges — the two transactions are independent" },
              ],
              why: "A→B (A wants row 2, held by B) and B→A (B wants row 1, held by A) close a loop: no one finishes without a victim abort.",
            },
          },
        ],
      },
      {
        id: "durability-commit",
        title: "What COMMIT actually promises",
        minutes: 5,
        intro:
          "COMMIT isn't 'done in memory' — its contract is that your write survives a power cut, which is a disk-write promise.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "When COMMIT returns, the transaction's WAL records must be **fsync'd** — forced to the device — before the acknowledgement goes back to the app. The in-memory dirty pages can flush later; the log record is what survives the crash and replays the change.\n\nThe only real latitude is *when* the fsync happens. `synchronous_commit=off` lets COMMIT reply before the log hits disk, shaving latency — and trading away the durability of the very last writes on power loss. Group commit batches many transactions into one fsync to buy both. 'Committed' that can vanish is a misnomer; the setting is the caveat.",
          },
          {
            kind: "callout",
            title: "First principles",
            body:
              "Durable = on disk (WAL), not in RAM. Commit-before-fsync buys latency but can lose last-committed writes in a crash; every durability knob is that single trade on a slider.",
          },
          {
            kind: "task",
            task: {
              kind: "plan-choice",
              prompt:
                "The app got 'committed' acknowledgements, yet a power cut lost the last few writes. What was most likely switched off to cut latency?",
              answer: "sync",
              options: [
                { id: "sync", label: "The fsync-before-ack (e.g. synchronous_commit=off)" },
                { id: "index", label: "A redundant B-Tree index on the hot table" },
                { id: "log", label: "The write-ahead log itself — replaced by in-memory state" },
              ],
              why: "Replying before the log fsync — the setting's whole point — is precisely the window where committed-but-unfsync'd writes can be lost to power loss.",
            },
          },
        ],
      },
      {
        id: "capstone-dirty-read",
        title: "Capstone · The Dirty Read Bug",
        minutes: 7,
        intro: "A support agent quotes a balance that never committed.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Under READ UNCOMMITTED, a balance-check read leaks txn A's transient −100 (400) while the payment is mid-flight. Raise the isolation level until the reader is blocked from uncommitted values.",
          },
          {
            kind: "capstone",
            challengeId: "dirty_read",
            note: "Open the Isolation lab, set the isolation level, and watch the anomaly disappear in the timeline.",
          },
        ],
      },
      {
        id: "capstone-deadlock",
        title: "Capstone · The Deadlock Resolution",
        minutes: 7,
        intro: "Two checkout transactions that can never finish.",
        blocks: [
          {
            kind: "prose",
            markdown:
              "Two checkout paths update the same rows in opposite orders. Give both transactions one consistent lock ordering and confirm both commit.",
          },
          {
            kind: "capstone",
            challengeId: "deadlock_resolution",
            note: "Open the Isolation lab, pick the global lock ordering, and clear the Wait-For cycle.",
          },
        ],
      },
    ],
  },
];

export function unitFor(unitId: string): Unit | undefined {
  return UNITS.find((u) => u.id === unitId);
}

export function lessonFor(lessonId: string): { unit: Unit; lesson: Lesson } | undefined {
  for (const unit of UNITS) {
    const lesson = unit.lessons.find((l) => l.id === lessonId);
    if (lesson) return { unit, lesson };
  }
  return undefined;
}

/** Flatten all lessons in course order (units in order, lessons in order). */
export const COURSE_LESSONS: { unit: Unit; lesson: Lesson }[] = UNITS.flatMap((unit) =>
  unit.lessons.map((lesson) => ({ unit, lesson })),
);