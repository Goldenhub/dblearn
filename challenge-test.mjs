import assert from "node:assert";
import { CHALLENGES } from "./src/lib/challenges/catalog.ts";
import {
  evaluateChallenge,
  usesCorrelatedSubquery,
  simulateBufferPool,
  runDeadlockModel,
  bufferTrace,
  seqPageCount,
  indexLookupPageCount,
  structuralResultPass,
} from "./src/lib/engine/challengeEngine.ts";
import { ConcurrencySim } from "./src/lib/engine/concurrency.ts";

function ch(id) {
  return CHALLENGES.find((c) => c.id === id);
}

const results = [];
const jobs = [];

function check(name, fn) {
  jobs.push(
    (async () => {
      try {
        await fn();
        results.push(`PASS ${name}`);
      } catch (e) {
        results.push(`FAIL ${name}: ${e.message}`);
      }
    })(),
  );
}

// --- static I/O model: seq vs index read counts ---
check("seq vs index read counts", async () => {
  assert.equal(seqPageCount(500000), 7813);
  assert.equal(indexLookupPageCount(500000), 4);
});

// --- correlated subquery detection ---
check("correlated subquery detection", async () => {
  assert.equal(usesCorrelatedSubquery("SELECT (SELECT u.name FROM users u WHERE u.id = t.user_id) AS name FROM txns t"), true);
  assert.equal(usesCorrelatedSubquery("SELECT t.amount, u.name FROM txns t JOIN users u ON u.id = t.user_id"), false);
  assert.equal(usesCorrelatedSubquery("SELECT (SELECT MAX(amount) FROM txns WHERE txns.tx_id = 1) AS m FROM txns t"), false);
  assert.equal(usesCorrelatedSubquery("SELECT (SELECT u.name FROM users AS u WHERE u.id = t.user_id) FROM txns t"), true);
});

// --- structural result pass ---
check("structuralResultPass intent checks", async () => {
  assert.equal(structuralResultPass(ch("missing_index"), "SELECT id, code FROM events WHERE user_id = 42"), true);
  assert.equal(structuralResultPass(ch("missing_index"), "SELECT id, code FROM events WHERE country = 'US'"), false);
  assert.equal(structuralResultPass(ch("n_plus_one"), "SELECT t.tx_id, u.name FROM txns t JOIN users u ON u.id = t.user_id"), true);
  assert.equal(structuralResultPass(ch("n_plus_one"), "SELECT (SELECT u.name FROM users u WHERE u.id = t.user_id) FROM txns t"), false);
});

// --- missing_index challenge ---
check("missing_index default (no index) fails", async () => {
  const sub = { kind: "sql", sql: "SELECT id, code FROM events WHERE user_id = 42", indexColumn: null };
  const eval_ = await evaluateChallenge(ch("missing_index"), sub, { attempts: 1, hintsUsed: 0 });
  assert.equal(eval_.passed, false);
  assert.ok(eval_.failures.length >= 2);
  assert.ok(eval_.metrics.reads > 5000);
});

check("missing_index with index passes 3 stars", async () => {
  const sub = { kind: "sql", sql: "SELECT id, code FROM events WHERE user_id = 42", indexColumn: "user_id" };
  const eval_ = await evaluateChallenge(ch("missing_index"), sub, { attempts: 1, hintsUsed: 0 });
  assert.equal(eval_.passed, true);
  assert.equal(eval_.stars, 3);
  assert.ok(eval_.metrics.reads <= 10);
  assert.equal(eval_.metrics.scanMode, "index");
});

// --- n_plus_one ---
check("n_plus_one correlated subquery fails", async () => {
  const sub = { kind: "sql", sql: "SELECT t.tx_id, (SELECT u.name FROM users u WHERE u.id = t.user_id) AS name FROM txns t", indexColumn: null };
  const eval_ = await evaluateChallenge(ch("n_plus_one"), sub, { attempts: 1, hintsUsed: 0 });
  assert.equal(eval_.passed, false);
  assert.ok(eval_.metrics.reads > 100000, "N+1 reads explosive");
});

check("n_plus_one join passes", async () => {
  const sub = { kind: "sql", sql: "SELECT t.tx_id, u.name FROM txns t JOIN users u ON u.id = t.user_id", indexColumn: null };
  const eval_ = await evaluateChallenge(ch("n_plus_one"), sub, { attempts: 1, hintsUsed: 0 });
  assert.equal(eval_.passed, true);
  assert.ok(eval_.metrics.reads <= 500);
});

// --- dirty_read ---
check("dirty read at RU fails", async () => {
  const eval_ = await evaluateChallenge(ch("dirty_read"), { kind: "isolation", isolation: "read_uncommitted" }, { attempts: 1, hintsUsed: 0 });
  assert.equal(eval_.passed, false);
});

check("dirty read cleared at RC", async () => {
  const eval_ = await evaluateChallenge(ch("dirty_read"), { kind: "isolation", isolation: "read_committed" }, { attempts: 1, hintsUsed: 0 });
  assert.equal(eval_.passed, true);
  assert.equal(eval_.stars, 3);
});

check("dirty read cleared at RR and SERIALIZABLE too", async () => {
  for (const iso of ["repeatable_read", "serializable"]) {
    const eval_ = await evaluateChallenge(ch("dirty_read"), { kind: "isolation", isolation: iso }, { attempts: 1, hintsUsed: 0 });
    assert.equal(eval_.passed, true, `${iso} should pass`);
  }
});

// --- buffer ---
check("buffer 4 frames fails, 16 passes", async () => {
  const bad = await evaluateChallenge(ch("buffer_thrash"), { kind: "buffer", frameCount: 4, policy: "lru" }, { attempts: 1, hintsUsed: 0 });
  assert.equal(bad.passed, false);
  assert.ok(bad.metrics.reads > 120);
  const good = await evaluateChallenge(ch("buffer_thrash"), { kind: "buffer", frameCount: 16, policy: "lru" }, { attempts: 1, hintsUsed: 0 });
  assert.equal(good.passed, true);
  assert.ok(good.metrics.reads < 120);
  const clock = await evaluateChallenge(ch("buffer_thrash"), { kind: "buffer", frameCount: 16, policy: "clock" }, { attempts: 1, hintsUsed: 0 });
  assert.equal(clock.passed, true, "clock @16 should pass");
});

check("simulateBufferPool monotonic", async () => {
  const tr = bufferTrace();
  const r4 = simulateBufferPool(tr, 4, "lru");
  const r16 = simulateBufferPool(tr, 16, "lru");
  assert.ok(r16.hits > r4.hits);
  assert.ok(r16.reads < r4.reads);
  assert.equal(r4.hits + r4.reads, tr.length);
});

// --- deadlock ---
check("deadlock: mixed -> cycle, asc/desc -> clean", async () => {
  const mixed = runDeadlockModel("mixed");
  assert.equal(mixed.deadlocks, 1, "mixed ordering deadlocks");
  assert.equal(mixed.txnCommitted.B, false, "victim B aborted");
  assert.equal(mixed.txnCommitted.A, true, "A commits");
  const asc = runDeadlockModel("asc");
  assert.equal(asc.deadlocks, 0);
  assert.equal(asc.txnCommitted.A, true);
  assert.equal(asc.txnCommitted.B, true);
  const desc = runDeadlockModel("desc");
  assert.equal(desc.deadlocks, 0);
});

check("deadlock challenge passes with asc", async () => {
  const eval_ = await evaluateChallenge(ch("deadlock_resolution"), { kind: "locks", ordering: "asc" }, { attempts: 2, hintsUsed: 0 });
  assert.equal(eval_.passed, true);
  assert.equal(eval_.stars, 2); // attempt 2
  const mixed = await evaluateChallenge(ch("deadlock_resolution"), { kind: "locks", ordering: "mixed" }, { attempts: 1, hintsUsed: 0 });
  assert.equal(mixed.passed, false);
  assert.equal(mixed.stars, 1);
});

// --- ConcurrencySim sanity under challenge isolation choices ---
check("isolation sim handles RC/RR cleanly", async () => {
  const events = [
    { txnId: "A", op: "begin" },
    { txnId: "B", op: "begin" },
    { txnId: "A", op: "update", rowId: 1, delta: -100 },
    { txnId: "B", op: "select", rowId: 1 },
    { txnId: "B", op: "commit" },
    { txnId: "A", op: "commit" },
  ];
  for (const iso of ["read_uncommitted", "read_committed", "repeatable_read", "serializable"]) {
    const { steps, summary } = new ConcurrencySim({ isolation: iso, events }).run();
    const dirty = summary.anomalies.some((a) => a.kind === "dirty");
    const waits = steps.filter((s) => s.kind === "lock-wait").length;
    if (iso === "read_uncommitted") {
      assert.equal(dirty, true, "RU allows dirty reads");
      assert.equal(waits, 0, "RU never blocks");
    } else {
      assert.equal(dirty, false, `${iso} blocks dirty reads`);
      assert.ok(waits >= 1, `${iso} parks the reader behind the writer`);
    }
  }
});

await Promise.all(jobs);
console.log(results.join("\n"));
const failedCount = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
process.exit(failedCount === 0 ? 0 : 1);