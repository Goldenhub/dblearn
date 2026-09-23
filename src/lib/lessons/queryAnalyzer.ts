/**
 * Static SQL analyzer for Learn tasks.
 *
 * "Write a query and read what it does to the database" is the Mongeesy-style
 * heart of the course, but running DuckDB per keystroke is neither weight-light
 * nor crash-proof (duckdb-wasm 1.32 `_setThrew` on materializing queries). So
 * this module answers the interpreted question — *which tables did the query
 * touch, how, how many pages, and why* — with the same closed-form I/O model as
 * the challenge engine (8 KiB pages, 128 B rows, 0.1 ms per page read), without
 * ever executing SQL.
 *
 * It is a light tokenizer, not a SQL grammar: it looks at FROM / JOIN / ON /
 * WHERE / INSERT INTO / UPDATE / DELETE FROM and the `alias.column` references
 * they contain, and reports what a planner would most likely do with those
 * references against a known catalog (row counts + indexed columns). That is
 * enough to teach seq-scan vs index-seek, N+1 vs JOIN, and DML write cost.
 *
 * Keep this module free of browser-only / worker-only imports so it can be
 * unit-tested under Node.
 */

import {
  indexLookupPageCount,
  seqPageCount,
} from "../engine/challengeEngine";

export type SqlStatement = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "UNKNOWN";

/** A table the analyzer knows about (row count + which columns carry indexes). */
export interface CatalogTable {
  name: string;
  rows: number;
  /** Columns with a usable index (PK implied). A filter on any of these → index seek. */
  indexedColumns: string[];
}

export interface TableAccess {
  name: string;
  rows: number;
  /** Columns the query references inside WHERE / JOIN ON. */
  filterColumns: string[];
  /** How the planner would read this table. */
  mode: "index" | "seq";
  /** Pages touched for this table. */
  pages: number;
}

export type WarningCode =
  | "SEQUENTIAL_SCAN_ON_LARGE_TABLE"
  | "FILTER_MISSING_INDEX"
  | "UNFILTERED_DELETE"
  | "UNFILTERED_UPDATE"
  | "N_PLUS_ONE"
  | "LIKE_LEADING_WILDCARD"
  | "EXPRESSION_ON_INDEXED_COLUMN"
  | "SELECT_STAR_ON_LARGE_TABLE"
  | "UNKNOWN_STATEMENT";

/** Static interpretation of a submitted query against a catalog. */
export interface QueryAnalysis {
  statement: SqlStatement;
  /** Tables read/written, in FROM order (only those present in the catalog). */
  tables: TableAccess[];
  /** JOIN ... ON ... pairs written as "l.col = r.col" (detected from ON/WHERE). */
  joinPairs: string[];
  /** True if a correlated scalar subquery fires per outer row. */
  correlated: boolean;
  /** Total page reads (SELECT; also the scan cost for UPDATE/DELETE). */
  reads: number;
  /** Pages dirtied for DML; 0 for SELECT. */
  writes: number;
  estimatedMs: number;
  warnings: WarningCode[];
  /** Two-line human "what this query does to the database". */
  summary: string;
}

const PAGE_IO_MS = 0.1;
const LARGE_TABLE_ROWS = 200_000;

/* ------------------------------------------------------------------ *
 * Token helpers
 * ------------------------------------------------------------------ */

/** Reserved words that are not column references. */
const SQL_KEYWORDS = new Set(
  (
    "SELECT FROM WHERE JOIN INNER LEFT RIGHT FULL OUTER ON AS AND OR NOT IN IS NULL " +
    "BETWEEN LIKE ILIKE ESCAPE ORDER BY GROUP HAVING LIMIT OFFSET SET UPDATE DELETE INSERT INTO " +
    "VALUES CASE WHEN THEN ELSE END DISTINCT ALL EXISTS CAST USING NATURAL CROSS UNION INTERSECT " +
    "EXCEPT DESC ASC NULLS FIRST LAST WINDOW FETCH RETURNING DEFAULT PRIMARY KEY CONSTRAINT"
  )
    .split(/\s+/)
    .map((w) => w.toLowerCase()),
);

/** Bare `identifier` tokens in clause text (strings/numbers/keywords excluded). */
function bareIdentifiers(text: string): string[] {
  const cleaned = text
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ");
  const out: string[] = [];
  const re = /[a-z_][a-z0-9_]*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const w = m[0].toLowerCase();
    if (w.length < 2 || SQL_KEYWORDS.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/;\s*$/, "");
}

/** Uppercased, comment-stripped, whitespace-collapsed copy for clause scans. */
function normalize(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim();
}

/** Return the text of a clause starting at a match of `startRe`. */
function clauseAfter(
  norm: string,
  startRe: RegExp,
): string | null {
  const start = norm.search(startRe);
  if (start < 0) return null;
  return norm.slice(start);
}

/** Pull `alias.column` (cast as `table.column` via alias map) from clause text. */
function referencedColumns(
  clause: string,
  aliases: Map<string, string>,
): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  const re = /([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause)) !== null) {
    const left = m[1]!.toLowerCase();
    const table = aliases.get(left) ?? left;
    out.push({ table, column: m[2]!.toLowerCase() });
  }
  return out;
}

/** Detect a correlated scalar subquery: `(SELECT x FROM t2 a WHERE a.k = o.k)`. */
export function usesCorrelatedSubquery(sql: string): boolean {
  const body = stripComments(sql).replace(/\s+/g, " ");
  const re =
    /\(\s*select\s+[^)]*?from\s+([a-z_][a-z0-9_]*)(\s+(?:as\s+)?[a-z_][a-z0-9_]*)?[\s\S]*?where\s+[a-z_][a-z0-9_]*\.\w+\s*=\s*([a-z_][a-z0-9_]*)\.\w+\s*\)/gi;
  const m = re.exec(body);
  if (!m) return false;
  const innerAlias = m[2] ? m[2].trim().replace(/^as\s+/i, "") : m[1].toLowerCase();
  const outerRef = m[3]!.toLowerCase();
  // Correlated iff a *different* (outer) alias appears on the RHS of the inner WHERE.
  return outerRef !== innerAlias;
}

/**
 * Columns wrapped in a scalar expression that disables an index: function
 * calls, C-style casts, and arithmetic on a column (`WHERE col + 1 = 9`).
 * Returns `{qual, column}` where `qual` is an optional alias/table prefix.
 */
function expressionWrappedColumns(clause: string): { qual: string | undefined; column: string }[] {
  const out: { qual: string | undefined; column: string }[] = [];
  const seen = new Set<string>();
  const funcRe =
    /\b(?:lower|upper|trim|btrim|ltrim|rtrim|initcap|abs|ceil|floor|round|length|char_length|char_lenght|substr|substring|replace|coalesce|nullif|to_char|to_date|to_timestamp|to_number|not|is|cast)\s*\(\s*([a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;
  const arithRe = /([a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*[+*/-]\s*\d+/gi;
  const push = (qual: string | undefined, column: string) => {
    const key = `${qual ?? ""}.${column}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ qual, column });
  };
  let m: RegExpExecArray | null;
  while ((m = funcRe.exec(clause)) !== null) {
    const qual = m[1] ?? undefined;
    const column = m[2]!.toLowerCase();
    if (column) push(qual, column);
  }
  while ((m = arithRe.exec(clause)) !== null) {
    const qual = m[1] ?? undefined;
    const column = m[2]!.toLowerCase();
    if (column) push(qual, column);
  }
  return out;
}

/** Render segments for the page-read costometer (one per touched table). */
export function analysisToSegments(
  analysis: QueryAnalysis,
): { label: string; pages: number; kind: "seq" | "index" | "write" }[] {
  return analysis.tables.map((t) => ({
    label: t.name,
    pages: t.pages,
    kind: t.mode === "index" ? "index" : "seq",
  }));
}

/* ------------------------------------------------------------------ *
 * Main analysis
 * ------------------------------------------------------------------ */

/**
 * Interpret `sql` against a catalog. Returns an analysis that is safe for any
 * string (including garbage): unknown statements and empty catalogs become
 * warnings, never throws.
 */
export function analyzeQuery(sql: string, catalog: CatalogTable[]): QueryAnalysis {
  const norm = normalize(sql);
  const warningCodes: WarningCode[] = [];
  const tables: TableAccess[] = [];
  const joinPairs: string[] = [];
  const aliasMap = new Map<string, string>();

  const firstWord = /^([a-z]+)/i.exec(norm)?.[1]?.toUpperCase() ?? "UNKNOWN";
  let statement: SqlStatement = "UNKNOWN";
  if (["SELECT", "INSERT", "UPDATE", "DELETE"].includes(firstWord)) {
    statement = firstWord as SqlStatement;
  } else {
    warningCodes.push("UNKNOWN_STATEMENT");
  }

  // A leading-wildcard LIKE (`LIKE '%x'`) can never use a B-Tree prefix scan,
  // whatever columns are indexed.
  if (/\blike\s+'%/i.test(norm)) {
    warningCodes.push("LIKE_LEADING_WILDCARD");
  }

  // 1. Collect FROM / JOIN targets with aliases.
  if (statement === "SELECT") {
    for (const kind of ["FROM", "JOIN"]) {
      const re = new RegExp(
        `\\b${kind}\\s+([a-z_][a-z0-9_]*)(?:\\s+(?:AS\\s+)?([a-z_][a-z0-9_]*))?`,
        "gi",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(norm)) !== null) {
        const table = m[1]!.toLowerCase();
        // The optional alias group greedily grabs the next token (e.g. WHERE);
        // ignore it unless it's a real alias (not a reserved word).
        const alias =
          m[2] && !SQL_KEYWORDS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : table;
        aliasMap.set(alias, table);
      }
    }
  }

  // 2. DML target.
  let target: string | null = null;
  if (statement === "UPDATE") {
    target = /^\s*UPDATE\s+([a-z_][a-z0-9_]*)/i.exec(norm)?.[1]?.toLowerCase() ?? null;
    if (target) aliasMap.set(target, target);
  } else if (statement === "DELETE") {
    target =
      /^\s*DELETE\s+FROM\s+([a-z_][a-z0-9_]*)/i.exec(norm)?.[1]?.toLowerCase() ??
      null;
    if (target) aliasMap.set(target, target);
  } else if (statement === "INSERT") {
    target =
      /^\s*INSERT\s+INTO\s+([a-z_][a-z0-9_]*)/i.exec(norm)?.[1]?.toLowerCase() ??
      null;
    if (target) aliasMap.set(target, target);
  }

  // 3. Which catalog tables are actually touched? (aliases map to table names)
  const aliasedTables = new Set([...aliasMap.values()]);
  const involved = catalog.filter((t) => aliasedTables.has(t.name.toLowerCase()));
  const present = new Set<string>([
    ...involved.map((t) => t.name.toLowerCase()),
    ...(target ? [target.toLowerCase()] : []),
  ]);

  // 4. WHERE / ON columns.
  const whereAndOn: string[] = [];
  if (statement === "SELECT") {
    for (const kw of ["WHERE", "ON", "HAVING"]) {
      const re = new RegExp(`\\b${kw}\\s+`, "gi");
      const slice = clauseAfter(norm, re);
      if (slice) whereAndOn.push(slice);
    }
    // JOIN pairs: the ON clauses of each JOIN.
    const onRe = /\bON\s+([a-z_][a-z0-9_]*\.\w+\s*=\s*[a-z_][a-z0-9_]*\.\w+)/gi;
    let m: RegExpExecArray | null;
    while ((m = onRe.exec(norm)) !== null) {
      joinPairs.push(m[1]!.toLowerCase().replace(/\s+/g, " "));
    }
  } else {
    // DML: everything after SET / the whole statement is the filter scope.
    if (statement === "UPDATE") {
      const setIdx = norm.search(/\bSET\s+/i);
      whereAndOn.push(setIdx >= 0 ? norm.slice(setIdx) : norm);
    } else {
      whereAndOn.push(norm);
    }
  }
  const refs = referencedColumns(whereAndOn.join(" "), aliasMap);

  const filterByTable = new Map<string, string[]>();
  for (const r of refs) {
    // Only keep refs to present tables; dedupe.
    if (present.has(r.table)) {
      const list = filterByTable.get(r.table) ?? [];
      if (!list.includes(r.column)) list.push(r.column);
      filterByTable.set(r.table, list);
    }
  }

  // Single-table statements often filter on bare columns (no alias prefix),
  // e.g. `WHERE user_id = 42`. Attribute unqualified identifiers to the one
  // table in scope when it is unambiguous.
  if (involved.length === 1) {
    const only = involved[0]!.name.toLowerCase();
    const banned = new Set([only, ...involved.map((t) => t.name.toLowerCase())]);
    for (const col of bareIdentifiers(whereAndOn.join(" "))) {
      if (banned.has(col)) continue;
      const list = filterByTable.get(only) ?? [];
      if (!list.includes(col)) list.push(col);
      filterByTable.set(only, list);
    }
  }

  // A filter like `CAST(id AS TEXT) = '7'`, `LOWER(name) = 'x'` or `id + 1 = 9`
  // disables the index that column would otherwise use — the planner must fall
  // back to a sequential scan. Record the disabled columns per table.
  const disabledByExpression = new Map<string, Set<string>>();
  for (const e of expressionWrappedColumns(whereAndOn.join(" "))) {
    const table = e.qual
      ? aliasMap.get(e.qual.toLowerCase())
      : involved.length === 1
        ? involved[0]?.name.toLowerCase()
        : undefined;
    if (!table || !present.has(table)) continue;
    const idxCols = catalog
      .find((t) => t.name.toLowerCase() === table)
      ?.indexedColumns.map((c) => c.toLowerCase());
    if (idxCols?.includes(e.column)) {
      warningCodes.push("EXPRESSION_ON_INDEXED_COLUMN");
      const set = disabledByExpression.get(table) ?? new Set<string>();
      set.add(e.column);
      disabledByExpression.set(table, set);
    }
  }

  // 5. Per-table access mode + page cost.
  let reads = 0;
  let writes = 0;
  if (statement === "INSERT") {
    // Appending one row touches the last heap page (1 page write; allocates a
    // new page if full — modelled as 1 write for teaching).
    writes = 1;
    reads = 0;
  } else {
    for (const t of involved) {
      const filters = filterByTable.get(t.name.toLowerCase()) ?? [];
      const idxCols = t.indexedColumns.map((i) => i.toLowerCase());
      const disabled = disabledByExpression.get(t.name.toLowerCase());
      const indexed = filters.some(
        (c) => idxCols.includes(c) && !(disabled?.has(c) ?? false),
      );
      const mode = indexed ? "index" : "seq";
      const pages =
        mode === "index"
          ? indexLookupPageCount(t.rows)
          : seqPageCount(t.rows);
      if (!indexed && filters.length > 0 && t.indexedColumns.length > 0) {
        warningCodes.push("FILTER_MISSING_INDEX");
      }
      tables.push({ name: t.name, rows: t.rows, filterColumns: filters, mode, pages });
      reads += pages;
      if (statement === "UPDATE" || statement === "DELETE") writes += pages;
    }
  }

  if (statement === "UPDATE" || statement === "DELETE") {
    const hasWhere = /\bWHERE\b/i.test(norm);
    if (!hasWhere) {
      warningCodes.push(
        statement === "DELETE" ? "UNFILTERED_DELETE" : "UNFILTERED_UPDATE",
      );
    }
  }

  // 6. Large-table scans that a filter should have avoided.
  for (const t of tables) {
    if (t.mode === "seq" && t.rows >= LARGE_TABLE_ROWS) {
      warningCodes.push("SEQUENTIAL_SCAN_ON_LARGE_TABLE");
    }
  }

  // 7. `SELECT *` over a large table pulls whole rows off every page.
  if (
    statement === "SELECT" &&
    /\bselect\s+(?:\*|[a-z_][a-z0-9_]*\.\*)(?:\s|$)/i.test(norm) &&
    involved.some((t) => t.rows >= LARGE_TABLE_ROWS)
  ) {
    warningCodes.push("SELECT_STAR_ON_LARGE_TABLE");
  }

  const correlated = usesCorrelatedSubquery(norm);
  if (correlated) warningCodes.push("N_PLUS_ONE");

  const estimatedMs = (reads + writes) * PAGE_IO_MS;

  // 7. Summary — the "what does this query actually do to the database" line.
  const summary = buildSummary(
    statement,
    target,
    tables,
    reads,
    writes,
    correlated,
  );

  return {
    statement,
    tables,
    joinPairs,
    correlated,
    reads,
    writes,
    estimatedMs,
    warnings: [...new Set(warningCodes)],
    summary,
  };
}

function buildSummary(
  statement: SqlStatement,
  target: string | null,
  tables: TableAccess[],
  reads: number,
  writes: number,
  correlated: boolean,
): string {
  const parts: string[] = [];
  if (statement === "SELECT") {
    if (correlated) {
      parts.push(
        "This query re-scans the inner table once per outer row (an N+1 pattern) — page reads multiply with row count instead of adding up.",
      );
    }
    if (tables.length === 0) {
      parts.push("The statement touches no table in the lesson catalog.");
    } else {
      const each = tables
        .map((t) =>
          t.mode === "index"
            ? `index-seeks ${t.name} (${t.pages} page${t.pages === 1 ? "" : "s"}) on ${t.filterColumns.join(", ") || "an indexed column"}`
            : `scan-${t.name} ${t.filterColumns.length ? `filtering ${t.filterColumns.join(", ")} after` : "reading"} all ${t.pages} page${t.pages === 1 ? "" : "s"}`,
        )
        .join(", ");
      parts.push(`Reads ${reads} page(s): ${each}.`);
      if (tables.some((t) => t.mode === "seq" && t.filterColumns.length > 0)) {
        parts.push(
          "A filter on a non-indexed column cannot skip pages — the engine reads the whole table first and filters in memory.",
        );
      }
    }
  } else if (statement === "INSERT") {
    parts.push(
      `Appends a row to ${target ?? "the table"} and dirties 1 page in the buffer pool (write ${
        writes
      }, read ${reads}).`,
    );
  } else if (statement === "UPDATE" || statement === "DELETE") {
    const where = tables.length ? "matching pages" : "the whole table";
    parts.push(
      `Reads then dirties ${writes} page(s) (${where}) of ${
        target ?? "the table"
      }.`,
    );
  } else {
    parts.push("This is not a statement this course can interpret.");
  }
  parts.push(
    `Total I/O ≈ ${((reads + writes) * PAGE_IO_MS).toFixed(1)} ms at ${PAGE_IO_MS} ms per page${
      writes > 0 ? " (reads + writes counted)" : ""
    }.`,
  );
  return parts.join(" ");
}

/** Human label + hint for a warning code (mirrors planTips naming style). */
export const WARNING_LABEL: Record<WarningCode, string> = {
  SEQUENTIAL_SCAN_ON_LARGE_TABLE:
    "Sequential scan on a large table — a filter with an index would skip most of these pages.",
  FILTER_MISSING_INDEX:
    "Filter on a non-indexed column — the table has indexes, but not for this lookup.",
  UNFILTERED_DELETE:
    "DELETEs the entire table — every page is scanned and rewritten.",
  UNFILTERED_UPDATE:
    "UPDATE touches every row — no WHERE to limit the pages dirtied.",
  N_PLUS_ONE:
    "Correlated subquery per row — inner reads × outer rows. A JOIN reads each table once.",
  LIKE_LEADING_WILDCARD:
    "A leading wildcard ('LIKE %x') forces a sequential scan — a B-Tree can only prefix-scan.",
  EXPRESSION_ON_INDEXED_COLUMN:
    "Function/cast/arithmetic on an indexed column disables that index — the planner falls back to a scan.",
  SELECT_STAR_ON_LARGE_TABLE:
    "SELECT * pulls every column off every page — request only the rows and columns you need.",
  UNKNOWN_STATEMENT: "Could not recognize the statement type.",
};