/**
 * First-principles database explanations attached to plan operators.
 *
 * Every tip sits on a mechanistic base layer (page I/O, CPU work, cache
 * behavior) rather than "this is just what engines do".
 */
import type { DuckDBPlanNode } from "@/lib/duckdb/protocol";

import type { WarningCode } from "./planMapper";

export interface PlanTip {
  title: string;
  body: string;
}

const COMMON_IO = {
  pageIdeal:
    "Databases work on fixed-size pages (typically 8 KB). Reading a page from disk costs ~50-100x more than reading it from the buffer pool in memory, so the number of pages touched, not rows, dominates scan cost.",
  cache:
    "The buffer pool is the same memory your OS caches. A hot working set stays in RAM; the moment a table no longer fits, sequential scans start waiting on page faults.",
} as const;

const OPERATOR_TIPS: Array<{
  match: (name: string) => boolean;
  tips: PlanTip[];
}> = [
  {
    match: (n) => n.includes("SCAN"),
    tips: [
      {
        title: "Sequential scan = read every page",
        body: `${COMMON_IO.pageIdeal} A full scan has no way to skip pages, so its cost is proportional to table size — that is why it is the baseline every index competes against.`,
      },
      {
        title: "Rows scanned vs rows returned",
        body: "operator_rows_scanned counts every row read off pages; operator_cardinality counts rows that survived the filter. A big gap means you paid to read rows you then threw away — the classic argument for an index or a tighter predicate.",
      },
    ],
  },
  {
    match: (n) => n.includes("HASH_JOIN"),
    tips: [
      {
        title: "Why a Hash Join?",
        body: "Hash joins build an in-memory hash table on the smaller input, then stream the larger input looking up each row. They cost O(|build| + |probe|) and shine for equi-joins where you need every matching pair once, regardless of correlation. No index on the join columns? A hash join ignores indexes entirely — it only needs the two inputs.",
      },
      {
        title: "Build vs probe side matters",
        body: "The optimizer builds on the smaller side to keep the hash table in cache. If the build side spills to disk, cost jumps dramatically — a hash join's memory is O(|small side|), its disk behavior is what bites.",
      },
    ],
  },
  {
    match: (n) => n.includes("NESTED_LOOP"),
    tips: [
      {
        title: "Why a Nested Loop?",
        body: "For a driver table row, probe the other side and stop. It is ideal when one side is tiny, when the join is non-equi (<, >, BETWEEN), or when a lookup exploits an index. Worst case is O(|outer| × |inner|) — quadratic, fine for 20×200, fatal for 1M×1M.",
      },
    ],
  },
  {
    match: (n) => n.includes("MERGE_JOIN"),
    tips: [
      {
        title: "Why a Merge Join?",
        body: "Both inputs arrive sorted on the join key, so matching is a single linear pass — they never re-scan. If the inputs are not already sorted (by an index or an ORDER BY), the sort cost usually makes a hash join cheaper.",
      },
    ],
  },
  {
    match: (n) => n.includes("CROSS") || n.includes("JOIN"),
    tips: [
      {
        title: "Every join row pair is materialized",
        body: "A cross product emits |left| × |right| rows. Joins without an equi-condition (LIKE, range, OR across columns) cannot use hash tables and degrade toward nested-loop behavior — so the cardinality you see here is the product, not a filtered set.",
      },
    ],
  },
  {
    match: (n) => n.includes("GROUP") || n.includes("AGGREGATE"),
    tips: [
      {
        title: "Grouping = hashing",
        body: "GROUP BY buckets rows into a hash table keyed by the group columns. Its memory is proportional to the number of distinct groups, not input size. Give it fewer, cheap-to-hash keys and the whole aggregate stays in cache.",
      },
      {
        title: "Spill semantics",
        body: "When groups outgrow memory, DuckDB spills hash buckets to disk. A spilled aggregate is often the single largest cost in a plan — reducing group cardinality or the key width is the lever.",
      },
    ],
  },
  {
    match: (n) => n.includes("ORDER") || n.startsWith("TOP_N"),
    tips: [
      {
        title: "Sorting costs O(n log n) writes",
        body: "A sort is not free: to use the OS it writes interim runs to memory/disk and merges them. TOP_N (LIMIT) avoids a full sort by keeping only the best k rows in a heap as it streams — far cheaper than sorting everything when k ≪ n.",
      },
      {
        title: "Memory vs disk spill",
        body: "If the sort spills, separate runs are written to temp space and merged back. operators show this as Disk/Run info in extra_info — spilled sorts scale like disk I/O, not memory bandwidth.",
      },
    ],
  },
  {
    match: (n) => n.startsWith("PROJECTION"),
    tips: [
      {
        title: "Projection is column slicing, not row filtering",
        body: "It simply keeps the requested columns for upstream operators. It cannot reduce the number of rows — only filters/joins do that — which is why its output cardinality equals its input.",
      },
    ],
  },
  {
    match: (n) => n.startsWith("FILTER"),
    tips: [
      {
        title: "A standalone FILTER means no pushdown",
        body: "When you see an explicit filter node above a scan, the predicate could not be pushed into the scan/index. Every row still gets read and then discarded. Ideal plans bundle the predicate into the scan itself (see extra_info.Filters on the scan node).",
      },
    ],
  },
  {
    match: (n) => n.includes("LIMIT"),
    tips: [
      {
        title: "Limits cancel work upstream",
        body: "A LIMIT propagates as a top-n hint: scans/joins can stop early instead of materializing everything. If you see the full sort before a small LIMIT, the optimizer chose not to (or could not) introduce top-n.",
      },
    ],
  },
  {
    match: (n) => n.startsWith("EXPLAIN"),
    tips: [
      {
        title: "This is the plan root",
        body: "EXPLAIN (ANALYZE, FORMAT JSON) wraps the real tree. All real work happens in its children; the root exists to time the whole query and attach global stats.",
      },
    ],
  },
];

function operatorTips(node: DuckDBPlanNode): PlanTip[] {
  const name = node.operator_name.toUpperCase();
  return OPERATOR_TIPS.filter((entry) => entry.match(name)).flatMap(
    (entry) => entry.tips,
  );
}

const WARNING_TIPS: Record<WarningCode, PlanTip> = {
  SEQ_SCAN_ON_LARGE_TABLE: {
    title: "Largest table read the dumb way",
    body: `This scan read the most rows in the plan with a sequential scan. ${COMMON_IO.pageIdeal} An index (or a more selective predicate pushed into the scan) would read far fewer pages.`,
  },
  FILTER_AFTER_SCAN: {
    title: "Predicate applied too late",
    body: "A filter node is discarding rows the scan already read. If the engine could push that predicate into the scan/index, I/O would drop to only the pages that contain matches.",
  },
  CROSS_JOIN: {
    title: "Cartesian product detected",
    body: "A join without real conditions multiplies rows (|left| × |right|). Nearly always a bug (missing ON clause) — or a deliberate operation to benchmark worst-case join cost.",
  },
  HIGH_TIMING_PCT: {
    title: "Hotspot operator",
    body: "This operator accounts for >40% of measured plan time. Time is not perfectly additive (operators overlap, caches warm), but it is the most useful single signal for where to spend optimization effort.",
  },
  DISK_SPILL: {
    title: "Worked memory exceeded, spills to disk",
    body: "Hash tables / sorts overflow the memory budget and write partitions to temporary storage. Spilled hash joins and sorts suddenly become disk-I/O-bound — the fastest fix is reducing the input or the per-row key/group width.",
  },
};

export function planTipsFor(node: DuckDBPlanNode): PlanTip[] {
  return operatorTips(node);
}

export function tipForWarning(code: WarningCode): PlanTip {
  return WARNING_TIPS[code];
}