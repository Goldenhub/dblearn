import { gradeTask } from "./src/lib/lessons/taskEngine.ts";
import { UNITS, lessonFor, COURSE_LESSONS, LESSON_SQL_CATALOG } from "./src/lib/lessons/curriculum.ts";
import { analyzeQuery } from "./src/lib/lessons/queryAnalyzer.ts";
import { recordLesson, getProgress, unitOfLesson } from "./src/lib/store/useProgressStore.ts";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(ok ? "PASS" : "FAIL", name, detail);
}

const ids = new Set();
for (const unit of UNITS)
  for (const lesson of unit.lessons) {
    check(`lessonFor(${lesson.id}) resolves`, Boolean(lessonFor(lesson.id)));
    check(`lesson id unique: ${lesson.id}`, !ids.has(lesson.id));
    ids.add(lesson.id);
    const kinds = new Set(lesson.blocks.map((b) => b.kind));
    if (kinds.has("capstone")) {
      check(`capstone lesson has no task: ${lesson.id}`, !kinds.has("task"));
    } else {
      check(`non-capstone lesson ${lesson.id} has a task`, kinds.has("task"), [...kinds].join(","));
    }
  }

function taskOf(lessonId) {
  return lessonFor(lessonId).lesson.blocks.find((b) => b.kind === "task").task;
}

// Number: correct answer passes, off-by-one fails.
check("rows-pages 1563", gradeTask(taskOf("rows-pages"), 1563).passed);
check("rows-pages 1563 wrong=1564", !gradeTask(taskOf("rows-pages"), 1564).passed);
check("seq-scan 313", gradeTask(taskOf("seq-scan-cost"), 313).passed);

// Plan-choice: correct id passes.
check("what-index (index)", gradeTask(taskOf("what-index"), "index").passed);
check("what-index (seq) fails", !gradeTask(taskOf("what-index"), "seq").passed);
check("deadlock-order (order)", gradeTask(taskOf("deadlock-order"), "order").passed);
check("read-plan (reads-all)", gradeTask(taskOf("read-plan"), "reads-all").passed);
check("nplusone (per-row)", gradeTask(taskOf("nplusone"), "per-row").passed);

// B-tree shape task (7 keys, t=2 → 3 nodes, 1-key root, height 2).
const btreeResult = gradeTask(taskOf("btree-mechanics"), null);
check("btree-mechanics shape", btreeResult.passed, btreeResult.detail);

// 128-key tree: hops ≤ 5.
const bigResult = gradeTask(taskOf("btree-vs-scan"), null);
check("btree-vs-scan hops", bigResult.passed, bigResult.detail);

// Buffer: 16/lru passes, 4/lru fails.
const b16 = gradeTask(taskOf("buffer-pool-intro"), { frames: 16, policy: "lru" });
check("buffer 16/lru", b16.passed, b16.detail);
const b4 = gradeTask(taskOf("buffer-pool-intro"), { frames: 4, policy: "lru" });
check("buffer 4/lru fails", !b4.passed, b4.detail);

// Isolation: RC/RR/SER fix dirty read, RU does not; phantom only at SER.
check("isolation RC", gradeTask(taskOf("locks-isolation"), "read_committed").passed);
check("isolation RR", gradeTask(taskOf("locks-isolation"), "repeatable_read").passed);
check("isolation SER", gradeTask(taskOf("locks-isolation"), "serializable").passed);
check("isolation RU fails", !gradeTask(taskOf("locks-isolation"), "read_uncommitted").passed);
check("phantom SER", gradeTask(taskOf("phantom-ranges"), "serializable").passed);
check("phantom RR fails", !gradeTask(taskOf("phantom-ranges"), "repeatable_read").passed);

// Foundations unit: plan-choice + number tasks.
check("what-is-a-db (storage)", gradeTask(taskOf("what-is-a-db"), "storage").passed);
check("how-reads-work (miss)", gradeTask(taskOf("how-reads-work"), "miss").passed);
check("how-writes-work (wal)", gradeTask(taskOf("how-writes-work"), "wal").passed);
check("memory-vs-disk 1000", gradeTask(taskOf("memory-vs-disk"), 1000).passed);
check("memory-vs-disk 1000 wrong=999", !gradeTask(taskOf("memory-vs-disk"), 999).passed);
check("pages-work 625", gradeTask(taskOf("pages-work"), 625).passed);
check("pages-work 625 wrong=626", !gradeTask(taskOf("pages-work"), 626).passed);

// Worked step-by-step calculations shown on every number task.
for (const id of ["memory-vs-disk", "pages-work", "rows-pages", "seq-scan-cost"]) {
  check(`${id} shows worked math`, Array.isArray(taskOf(id).work) && taskOf(id).work.length >= 2);
}
check(
  "rows-pages work includes the division",
  taskOf("rows-pages").work.some((w) => w.includes("100,000 ÷ 64")),
);

// SQL tasks: intent grading + analysis attached to the result.
const selectTask = taskOf("write-select");
const selectOk = gradeTask(selectTask, "SELECT id, code FROM events WHERE user_id = 42");
check("write-select default passes", selectOk.passed, selectOk.detail);
const selectWrong = gradeTask(selectTask, "SELECT id FROM customers");
check("write-select wrong table fails", !selectWrong.passed);
check("write-select attaches analysis", Boolean(selectWrong.data?.analysis?.tables?.length));

const joinTask = taskOf("write-join");
const joinBroken = gradeTask(
  joinTask,
  "SELECT o.order_id, o.amount, (SELECT c.name FROM customers c WHERE c.id = o.customer_id) AS name FROM orders o",
);
check("write-join correlated default fails", !joinBroken.passed);
check("write-join default warns N_PLUS_ONE", joinBroken.data?.analysis?.warnings?.includes("N_PLUS_ONE"));
const joinOk = gradeTask(
  joinTask,
  "SELECT o.order_id, o.amount, c.name FROM orders o JOIN customers c ON c.id = o.customer_id",
);
check("write-join rewrite passes", joinOk.passed, joinOk.detail);
check("write-join rewrite has no N+1", !joinOk.data?.analysis?.warnings?.includes("N_PLUS_ONE"));

// Curriculum shape: five units, single global track.
check("5 units", UNITS.length === 5, UNITS.map((u) => u.id).join(","));
check("unit 1 is foundations", UNITS[0].id === "foundations");
check("course order starts at what-is-a-db", COURSE_LESSONS[0].lesson.id === "what-is-a-db");
check("write lessons in execution", unitOfLesson["write-select"] === "execution");
check("foundations lessons mapped", unitOfLesson["what-is-a-db"] === "foundations" && unitOfLesson["pages-work"] === "foundations");

// Analyzer I/O cost checks (the "what does the query do" readout).
const catalog = LESSON_SQL_CATALOG;
const eventsScan = analyzeQuery("SELECT id, code FROM events WHERE user_id = 42", catalog);
check("events seq scan = 7813 reads", eventsScan.reads === 7813, String(eventsScan.reads));
check("events scan flagged large-table seq", eventsScan.warnings.includes("SEQUENTIAL_SCAN_ON_LARGE_TABLE"));
const customerLookup = analyzeQuery("SELECT id FROM customers WHERE id = 7", catalog);
check("customers indexed lookup is index mode", customerLookup.tables[0].mode === "index");
check("update without WHERE warns", analyzeQuery("UPDATE events SET code = 1", catalog).warnings.includes("UNFILTERED_UPDATE"));
check("delete without WHERE warns", analyzeQuery("DELETE FROM events", catalog).warnings.includes("UNFILTERED_DELETE"));
check("garbage sql warns unknown", analyzeQuery("garbage ???", catalog).warnings.includes("UNKNOWN_STATEMENT"));

// Progress store recordLesson.
recordLesson("rows-pages", { completedAt: 1, grade: 2 });
check("recordLesson persists", Boolean(getProgress().lessons["rows-pages"]));
check("unitOfLesson maps", unitOfLesson["rows-pages"] === "storage");

// Capstones map to the 5 challenge ids.
const capIds = UNITS.flatMap((u) => u.lessons.map((l) => l.blocks.find((b) => b.kind === "capstone")))
  .filter(Boolean)
  .map((b) => b.challengeId);
check("5 capstones present", capIds.length === 5, capIds.join(","));

// ---------------------------------------------------------------- Phase 7→8
// Course is now 60 lessons in a single track with the planned unit split.
check("course has 60 lessons", COURSE_LESSONS.length === 60, String(COURSE_LESSONS.length));
const unitContent = (id) =>
  UNITS.find((un) => un.id === id).lessons.filter(
    (l) => !l.blocks.some((b) => b.kind === "capstone"),
  );
check("foundations = 9 content", unitContent("foundations").length === 9);
check("storage = 11 content", unitContent("storage").length === 11);
check("indexes = 11 content", unitContent("indexes").length === 11);
check("execution = 13 content", unitContent("execution").length === 13);
check("transactions = 11 content", unitContent("transactions").length === 11);

// Every plan-choice lesson passes on its own answer, fails on a distractor.
for (const { lesson } of COURSE_LESSONS) {
  const task = lesson.blocks.find((b) => b.kind === "task")?.task;
  if (task?.kind === "plan-choice") {
    check(`${lesson.id} correct answer passes`, gradeTask(task, task.answer).passed);
    const wrong = task.options.find((o) => o.id !== task.answer);
    check(`${lesson.id} wrong answer fails`, !gradeTask(task, wrong?.id).passed);
  }
}

// Every number task passes on its answer, fails off-by-one, shows its steps.
for (const { lesson } of COURSE_LESSONS) {
  const task = lesson.blocks.find((b) => b.kind === "task")?.task;
  if (task?.kind === "number") {
    check(`${lesson.id} number passes`, gradeTask(task, task.answer).passed);
    check(`${lesson.id} number off-by-one fails`, !gradeTask(task, task.answer + 1).passed);
    check(`${lesson.id} shows worked math`, Array.isArray(task.work) && task.work.length >= 2);
  }
}

// Every btree task verifies against the engine.
for (const { lesson } of COURSE_LESSONS) {
  const task = lesson.blocks.find((b) => b.kind === "task")?.task;
  if (task?.kind === "btree") {
    const r = gradeTask(task, null);
    check(`${lesson.id} btree verifies`, r.passed, r.detail);
  }
}

// New specific answers: the anchor + the second cliff + the ratio reviews.
check("ssd-hdd-cliff 100", gradeTask(taskOf("ssd-hdd-cliff"), 100).passed);
check("latency-ladder-review 100000", gradeTask(taskOf("latency-ladder-review"), 100000).passed);
check("anchor-index-cost 3", gradeTask(taskOf("anchor-index-cost"), 3).passed);
check("cache-hit-ratio-math 26", gradeTask(taskOf("cache-hit-ratio-math"), 26).passed);
check("fanout-height-math 3", gradeTask(taskOf("fanout-height-math"), 3).passed);

// Index write tax: 80 keys → 40 pages, height 4.
const writeTax = gradeTask(taskOf("index-write-tax"), null);
check("index-write-tax 80→40 pages", writeTax.passed, writeTax.detail);

// Buffer 'requiresAll': both policies must clear the budget at 16 frames.
const clock16 = gradeTask(taskOf("lru-vs-clock"), { frames: 16, policy: "clock" });
check("lru-vs-clock 16/clock passes", clock16.passed, clock16.detail);
check("lru-vs-clock 16/lru passes", gradeTask(taskOf("lru-vs-clock"), { frames: 16, policy: "lru" }).passed);
check("lru-vs-clock 12/lru fails", !gradeTask(taskOf("lru-vs-clock"), { frames: 12, policy: "lru" }).passed);
check("lru-vs-clock 4/clock fails", !gradeTask(taskOf("lru-vs-clock"), { frames: 4, policy: "clock" }).passed);

// New isolation labs: dirty read at RC; non-repeatable gone at RR.
check("dirty-read-anomaly RC", gradeTask(taskOf("dirty-read-anomaly"), "read_committed").passed);
check("dirty-read-anomaly RU fails", !gradeTask(taskOf("dirty-read-anomaly"), "read_uncommitted").passed);
check("non-repeatable-anomaly RR", gradeTask(taskOf("non-repeatable-anomaly"), "repeatable_read").passed);
check("non-repeatable-anomaly RC fails", !gradeTask(taskOf("non-repeatable-anomaly"), "read_committed").passed);

// New warning codes from the extended analyzer.
const likeScan = analyzeQuery("SELECT name FROM customers WHERE name LIKE '%doe%'", catalog);
check("leading-wildcard warns", likeScan.warnings.includes("LIKE_LEADING_WILDCARD"));
const castScan = analyzeQuery("SELECT * FROM events WHERE CAST(id AS TEXT) = '7'", catalog);
check("expression-on-indexed warns", castScan.warnings.includes("EXPRESSION_ON_INDEXED_COLUMN"));
check("expression forces seq mode", castScan.tables[0].mode === "seq", castScan.tables[0].mode);
const arithScan = analyzeQuery("SELECT id FROM orders WHERE customer_id + 1 = 8", catalog);
check("arithmetic-on-indexed warns", arithScan.warnings.includes("EXPRESSION_ON_INDEXED_COLUMN"));
check("star-scope warns", analyzeQuery("SELECT * FROM orders", catalog).warnings.includes("SELECT_STAR_ON_LARGE_TABLE"));
check("alias-star warns", analyzeQuery("SELECT o.* FROM orders o", catalog).warnings.includes("SELECT_STAR_ON_LARGE_TABLE"));
check("narrow projection does not warn star", !analyzeQuery("SELECT order_id, amount FROM orders WHERE customer_id = 7", catalog).warnings.includes("SELECT_STAR_ON_LARGE_TABLE"));

// The new bad→good SQL tasks: broken state fails with the right warning, the
// rewrite passes, and the result carries the 'before' analysis for the meter.
const sqlCases = [
  {
    id: "bad-delete",
    bad: "DELETE FROM orders",
    warn: "UNFILTERED_DELETE",
    good: "DELETE FROM orders WHERE order_id = 42",
  },
  {
    id: "bad-update",
    bad: "UPDATE products SET price = price * 1.1",
    warn: "UNFILTERED_UPDATE",
    good: "UPDATE products SET price = price * 1.1 WHERE sku = 'A-1'",
  },
  {
    id: "select-star-scope",
    bad: "SELECT * FROM orders",
    warn: "SELECT_STAR_ON_LARGE_TABLE",
    good: "SELECT order_id, amount FROM orders WHERE customer_id = 7",
  },
  {
    id: "point-lookup-good",
    bad: "SELECT * FROM orders",
    warn: "SELECT_STAR_ON_LARGE_TABLE",
    good: "SELECT order_id, amount FROM orders WHERE order_id = 99",
  },
  {
    id: "cast-breaks-index",
    bad: "SELECT * FROM events WHERE CAST(id AS TEXT) = '7'",
    warn: "EXPRESSION_ON_INDEXED_COLUMN",
    good: "SELECT id, code FROM events WHERE id = 7",
  },
  {
    id: "wildcard-breaks-index",
    bad: "SELECT name FROM customers WHERE name LIKE '%doe%'",
    warn: "LIKE_LEADING_WILDCARD",
    good: "SELECT name FROM products WHERE sku = 'A-1'",
  },
  {
    id: "in-vs-join",
    bad: "SELECT e.id FROM events e WHERE e.user_id IN (SELECT c.id FROM customers c WHERE c.id = e.user_id)",
    warn: "N_PLUS_ONE",
    good: "SELECT e.id, e.code FROM events e JOIN customers c ON c.id = e.user_id",
  },
  {
    id: "explicit-join-keys",
    bad: "SELECT * FROM orders o, customers c",
    warn: "SELECT_STAR_ON_LARGE_TABLE",
    good: "SELECT o.order_id, o.amount, c.name FROM orders o JOIN customers c ON c.id = o.customer_id",
  },
  {
    id: "narrow-your-read",
    bad: "SELECT id, code FROM events",
    warn: "SEQUENTIAL_SCAN_ON_LARGE_TABLE",
    good: "SELECT id, code FROM events WHERE id = 42",
  },
  {
    id: "archive-with-where",
    bad: "UPDATE payments SET status = 'archived'",
    warn: "UNFILTERED_UPDATE",
    good: "UPDATE payments SET status = 'archived' WHERE account_id = 42",
  },
];
for (const c of sqlCases) {
  const task = taskOf(c.id);
  const bad = gradeTask(task, c.bad);
  check(`${c.id} broken state fails`, !bad.passed);
  check(`${c.id} broken warns ${c.warn}`, bad.data?.analysis?.warnings?.includes(c.warn));
  const good = gradeTask(task, c.good);
  check(`${c.id} rewrite passes`, good.passed, good.detail);
  check(`${c.id} meter has before analysis`, Boolean(good.data?.before?.tables?.length));
  const goodReads = good.data?.analysis?.reads ?? Infinity;
  const badReads = bad.data?.before?.reads ?? -1;
  check(`${c.id} rewrite reads fewer pages`, goodReads <= badReads, `${goodReads} <= ${badReads}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);