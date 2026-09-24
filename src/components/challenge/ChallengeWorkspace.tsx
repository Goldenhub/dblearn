"use client";

/**
 * Phase 6 — Guided Challenge Workspace. Split-pane UI: scenario story + goals
 * on the left, the interactive control center (SQL/index, isolation, buffer,
 * lock ordering) in the middle, and a live visualizer that swaps per category
 * on the right. "Run" evaluates the submission against the challenge's
 * assertions, then the feedback drawer shows the before/after metric diff and
 * the first-principles breakdown. Completions persist to the progress store.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { CHALLENGES, CATEGORY_LABEL, challengeFor } from "@/lib/challenges/catalog";
import { COURSE_LESSONS } from "@/lib/lessons/curriculum";
import {
  challengeAttempt,
  challengeCompleted,
  challengeStarted,
  captureException,
  courseCompleted,
  hintRevealed,
  queryError,
  unitCompleted,
} from "@/lib/dblearnlytics";
import {
  evaluateChallenge,
  DIRTY_READ_EVENTS,
  buildDeadlockScript,
  indexLookupPageCount,
  seqPageCount,
  type ChallengeSubmission,
  type Evaluation,
} from "@/lib/engine/challengeEngine";
import { ConcurrencySim, isolationLabel, type IsolationLevel } from "@/lib/engine/concurrency";
import TimelineGrid from "@/components/concurrency/TimelineGrid";
import LockMonitor from "@/components/concurrency/LockMonitor";
import QueryAnalysisPanel from "@/components/learn/QueryAnalysisPanel";
import ReadsAnimation, { type ReadSegment } from "@/components/challenge/ReadsAnimation";
import { analyzeQuery, analysisToSegments, type CatalogTable, type QueryAnalysis } from "@/lib/lessons/queryAnalyzer";
import { useTheme } from "@/lib/theme";
import {
  badgesFor,
  completedCount,
  getProgress,
  lessonCompleted,
  lessonsForUnit,
  recordChallenge,
  totalStars,
  useProgress,
} from "@/lib/store/useProgressStore";

// Monaco pulls in a large bundle and touches browser APIs — keep it out of SSR.
const SqlEditor = dynamic(() => import("@/components/sql-editor"), { ssr: false });

const ISOLATIONS: IsolationLevel[] = ["read_uncommitted", "read_committed", "repeatable_read", "serializable"];
const CLIENTS = ["A", "B", "C"] as const;

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export default function ChallengeWorkspace({
  initialChallengeId,
}: {
  /**
   * Challenge to open on mount. The parent remounts this component (via a
   * changing React `key`) when deep-linking from a Learn capstone, so no
   * setState-in-effect is needed.
   */
  initialChallengeId?: string;
}) {
  const { theme } = useTheme();
  const startId =
    initialChallengeId && challengeFor(initialChallengeId) ? initialChallengeId : CHALLENGES[0].id;
  const startDef = challengeFor(startId)?.defaultSubmission;
  const [challengeId, setChallengeId] = useState(startId);
  const challenge = useMemo(() => challengeFor(challengeId) ?? CHALLENGES[0], [challengeId]);

  // Draft config per category (reset when the challenge changes).
  const [sqlDraft, setSqlDraft] = useState<string>(startDef?.kind === "sql" ? startDef.sql : "");
  const [indexOn, setIndexOn] = useState(false);
  const [isolationDraft, setIsolationDraft] = useState<IsolationLevel>(
    startDef?.kind === "isolation" ? startDef.isolation : "read_uncommitted",
  );
  const [bufferFrames, setBufferFrames] = useState(startDef?.kind === "buffer" ? startDef.frameCount : 4);
  const [bufferPolicy, setBufferPolicy] = useState<"lru" | "clock">(
    startDef?.kind === "buffer" ? startDef.policy : "lru",
  );
  const [lockOrder, setLockOrder] = useState<"asc" | "desc" | "mixed">(
    startDef?.kind === "locks" ? startDef.ordering : "mixed",
  );

  const [revealedHints, setRevealedHints] = useState<Set<string>>(new Set());
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [eval_, setEval] = useState<Evaluation | null>(null);

  const progress = useProgress();
  const badges = useMemo(() => badgesFor(progress), [progress]);
  const completed = completedCount(progress);

  // Concurrency visualizer transport.
  const [simIdx, setSimIdx] = useState(0);
  const [simPlaying, setSimPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);

  // Reset per-challenge state when switching challenges.
  const selectChallenge = useCallback((id: string) => {
    const def = challengeFor(id)?.defaultSubmission;
    setChallengeId(id);
    setEval(null);
    setRunError(null);
    setRevealedHints(new Set());
    setAttempts(0);
    setSimIdx(0);
    setSimPlaying(false);
    setIndexOn(false);
    if (!def) return;
    if (def.kind === "sql") setSqlDraft(def.sql);
    if (def.kind === "isolation") setIsolationDraft(def.isolation);
    if (def.kind === "buffer") {
      setBufferFrames(def.frameCount);
      setBufferPolicy(def.policy);
    }
    if (def.kind === "locks") setLockOrder(def.ordering);
  }, []);

  const submission = useMemo<ChallengeSubmission>(() => {
    switch (challenge.category) {
      case "plan":
      case "btree":
        return { kind: "sql", sql: sqlDraft, indexColumn: indexOn ? (challenge.id === "missing_index" ? "user_id" : null) : null };
      case "concurrency":
        return challenge.id === "dirty_read"
          ? { kind: "isolation", isolation: isolationDraft }
          : { kind: "locks", ordering: lockOrder };
      case "buffer":
        return { kind: "buffer", frameCount: bufferFrames, policy: bufferPolicy };
    }
  }, [challenge, sqlDraft, indexOn, isolationDraft, bufferFrames, bufferPolicy, lockOrder]);

  // Concurrency sim for the live visualizer (independent of the graded eval).
  const sim = useMemo(() => {
    if (challenge.category !== "concurrency") return null;
    const events = challenge.id === "dirty_read" ? DIRTY_READ_EVENTS : buildDeadlockScript(lockOrder);
    const isolation = challenge.id === "dirty_read" ? isolationDraft : "repeatable_read";
    return new ConcurrencySim({ isolation, events }).run();
  }, [challenge, isolationDraft, lockOrder]);

  const effSimIdx = sim ? Math.min(simIdx, sim.steps.length - 1) : 0;

  // Analytics: challenge open + hint reveals.
  useEffect(() => {
    challengeStarted(challenge.id, challenge.title);
  }, [challenge]);

  useEffect(() => {
    if (revealedHints.size > 0) hintRevealed(challenge.id, revealedHints.size);
  }, [revealedHints, challenge]);

  // Live "what does this query do to the database" for the plan/btree capstones.
  const sqlCatalog = useMemo<CatalogTable[] | null>(() => {
    if (challenge.category !== "plan" && challenge.category !== "btree") return null;
    if (submission.kind !== "sql") return null;
    const tableIndexes: Record<string, string[]> =
      challenge.id === "n_plus_one"
        ? { users: ["id"], txns: ["tx_id"] }
        : challenge.id === "missing_index"
          ? { events: submission.indexColumn ? ["user_id"] : [] }
          : {};
    const rowEntries = Object.entries(challenge.rowCounts ?? {});
    const tables: CatalogTable[] =
      rowEntries.length > 0
        ? rowEntries.map(([name, rows]) => ({
            name,
            rows,
            indexedColumns: tableIndexes[name] ?? [],
          }))
        : [
            { name: "events", rows: 500_000, indexedColumns: tableIndexes.events ?? [] },
            { name: "users", rows: 2_000, indexedColumns: tableIndexes.users ?? [] },
          ];
    return tables;
  }, [challenge, submission]);

  const queryAnalysis = useMemo<QueryAnalysis | null>(() => {
    if (!sqlCatalog || submission.kind !== "sql") return null;
    try {
      return analyzeQuery(submission.sql, sqlCatalog);
    } catch {
      return null;
    }
  }, [sqlCatalog, submission]);

  useEffect(() => {
    if (!simPlaying || !sim) return;
    const iv = setInterval(() => {
      setSimIdx((i) => {
        if (i >= sim.steps.length - 1) {
          setSimPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 620 / simSpeed);
    return () => clearInterval(iv);
  }, [simPlaying, simSpeed, sim]);

  const runEval = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setRunError(null);
    setEval(null);
    try {
      const nextAttempt = attempts + 1;
      setAttempts(nextAttempt);
      const result = await evaluateChallenge(
        challenge,
        submission,
        { attempts: nextAttempt, hintsUsed: revealedHints.size },
      );
      challengeAttempt(challenge.id, result.passed, nextAttempt);
      if (result.passed) {
        recordChallenge(challenge.id, {
          completedAt: Date.now(),
          stars: result.stars,
          efficiency: result.efficiency,
          score: result.score,
          attempts: result.attempts,
          hintsUsed: result.hintsUsed,
        });
        challengeCompleted(challenge.id, result.stars, result.efficiency);
        const after = getProgress();
        const isCourseLessonDone = (id: string) => {
          const entry = COURSE_LESSONS.find((c) => c.lesson.id === id);
          if (!entry) return false;
          const cap = entry.lesson.blocks.find((b) => b.kind === "capstone");
          return cap ? Boolean(after.challenges[cap.challengeId]) : lessonCompleted(after, id);
        };
        const courseEntry = COURSE_LESSONS.find((c) =>
          c.lesson.blocks.some((b) => b.kind === "capstone" && b.challengeId === challenge.id),
        );
        if (courseEntry && lessonsForUnit(after, courseEntry.unit.id).every(isCourseLessonDone)) {
          unitCompleted(courseEntry.unit.id, courseEntry.unit.title, challenge.id);
        }
        if (COURSE_LESSONS.map((c) => c.lesson.id).every(isCourseLessonDone)) {
          courseCompleted(COURSE_LESSONS.length);
        }
      }
      setEval(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRunError(message);
      queryError("challenge", message);
      captureException(cause);
    } finally {
      setBusy(false);
    }
  }, [busy, challenge, submission, attempts, revealedHints.size]);

  return (
    <div className="flex flex-col bg-zinc-950 text-zinc-200 lg:h-full lg:overflow-y-auto">
      {/* challenge selector + progress */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {CHALLENGES.map((c) => {
          const done = progress.challenges[c.id];
          const active = c.id === challengeId;
          return (
            <button
              key={c.id}
              onClick={() => selectChallenge(c.id)}
              className={`group rounded-lg border px-2.5 py-1 text-left transition-colors ${
                active
                  ? "border-emerald-500/70 bg-emerald-100 dark:bg-emerald-950/40"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
              }`}
            >
              <p className={`font-mono text-[10px] font-semibold ${active ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-200"}`}>
                {c.title}
              </p>
              <p className="font-mono text-[9px] text-zinc-500">
                {CATEGORY_LABEL[c.category]} · {done ? `★ ${"★".repeat(done.stars)}` : "open"}
              </p>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-zinc-500">
          <span>
            challenges {completed}/{CHALLENGES.length}
          </span>
          <span>
            stars {totalStars(progress)}
          </span>
          <div className="flex gap-1">
            {badges.filter((b) => b.unlockedAt !== null).map((b) => (
              <span key={b.id} title={b.label} className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                ★
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* story row */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {challenge.title} · difficulty {"●".repeat(challenge.difficulty) + "○".repeat(3 - challenge.difficulty)}
        </p>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-zinc-400">{challenge.story}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-rose-700/90 dark:text-rose-300/90">Issue: {challenge.issue}</p>
      </div>

      {/* split panes */}
      <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(240px,280px)_minmax(360px,1fr)_minmax(380px,1fr)] lg:overflow-hidden">
        {/* left: schema + goals */}
        <aside className="min-h-0 border-b border-zinc-800 p-2.5 lg:min-w-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:pr-2.5">
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Schema
          </p>
          <div className="space-y-1.5">
            {challenge.schema.map((s) => (
              <div key={s.name} className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5">
                <p className="font-mono text-[10px] font-semibold text-zinc-300">{s.name}</p>
                <p className="text-[9px] leading-snug text-zinc-500">{s.detail}</p>
              </div>
            ))}
          </div>

          <p className="mb-1.5 mt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Goals
          </p>
          <ul className="space-y-1">
            {challenge.goals.map((g, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[10px] leading-snug text-zinc-400">
                <span className="mt-0.5 text-emerald-700 dark:text-emerald-500">✓</span>
                <span>{g}</span>
              </li>
            ))}
          </ul>

          <p className="mb-1.5 mt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Hints · attempt {attempts}
          </p>
          <div className="space-y-1">
            {challenge.hints.map((h) => {
              const shown = revealedHints.has(h.id);
              return (
                <button
                  key={h.id}
                  onClick={() => setRevealedHints((s) => new Set([...s, h.id]))}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-[10px] leading-snug transition-colors ${
                    shown
                      ? "border-amber-300/70 dark:border-amber-700/70 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-600"
                  }`}
                >
                  {shown ? h.text : h.id === "h1" ? "Reveal hint 1 (−10)" : "Reveal hint 2"}
                </button>
              );
            })}
          </div>

          <p className="mb-1.5 mt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Storage math
          </p>
          <div className="space-y-1 text-[10px] leading-snug text-zinc-500">
            <p>8 KiB pages · 128 B rows (64 rows/page)</p>
            {challenge.id === "missing_index" ? (
              <>
                <p>Seq scan: {fmt(seqPageCount(500_000))} reads ≈ {fmt(Math.round(seqPageCount(500_000) * 0.1))} ms</p>
                <p>Index seek: ~{indexLookupPageCount(500_000)} reads ≈ {(indexLookupPageCount(500_000) * 0.1).toFixed(1)} ms</p>
              </>
            ) : null}
          </div>
        </aside>

        {/* center: controls */}
        <section className="flex flex-col border-b border-zinc-800 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-9 shrink-0 items-center border-b border-zinc-800 px-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Control center · {CATEGORY_LABEL[challenge.category]}
          </div>

          {challenge.category === "plan" || challenge.category === "btree" ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800 px-3 py-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={indexOn}
                    onChange={(e) => setIndexOn(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Create B-Tree index
                  {indexOn ? (
                    <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                      {challenge.id === "missing_index" ? "ON events(user_id)" : "ON users(id)"}
                    </span>
                  ) : null}
                </label>
                <button
                  onClick={() => void runEval()}
                  disabled={busy}
                  className="ml-auto rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy ? "Evaluating…" : "Run & check ⏎"}
                </button>
              </div>
              <div className="h-[360px] lg:min-h-0 lg:flex-1">
                <SqlEditor value={sqlDraft} onChange={setSqlDraft} dark={theme === "dark"} />
              </div>
            </>
          ) : null}

          {challenge.category === "concurrency" ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {challenge.id === "dirty_read" ? (
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Txn B session isolation
                  </label>
                  <select
                    value={isolationDraft}
                    onChange={(e) => {
                      setIsolationDraft(e.target.value as IsolationLevel);
                      setSimIdx(0);
                    }}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500"
                  >
                    {ISOLATIONS.map((lv) => (
                      <option key={lv} value={lv}>
                        {isolationLabel(lv)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
                    Reader vs writer below — flip the level and step to watch the anomaly collapse.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Global lock ordering
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["asc", "desc", "mixed"] as const).map((o) => (
                      <button
                        key={o}
                        onClick={() => {
                          setLockOrder(o);
                          setSimIdx(0);
                        }}
                        className={`rounded-md border px-2 py-1.5 text-[10px] font-medium ${
                          lockOrder === o
                            ? "border-emerald-500/70 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                            : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600"
                        }`}
                      >
                        {o === "asc" ? "A:1→2 · B:1→2" : o === "desc" ? "A:2→1 · B:2→1" : "A:1→2 · B:2→1"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
                    {lockOrder === "mixed"
                      ? "Mixed ordering: A takes row 1 then 2, B takes 2 then 1 — the classic Wait-For cycle."
                      : "Global order: every transaction acquires rows in the same direction — a chain, not a cycle."}
                  </p>
                </div>
              )}
              <button
                onClick={() => void runEval()}
                disabled={busy}
                className="w-full rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? "Checking…" : "Check this configuration"}
              </button>
            </div>
          ) : null}

          {challenge.category === "buffer" ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Buffer pool size — {bufferFrames} × 8 KiB
                </label>
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  value={bufferFrames}
                  onChange={(e) => setBufferFrames(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <div className="mt-0.5 flex justify-between font-mono text-[9px] text-zinc-600">
                  <span>4 (thrash)</span>
                  <span>16 (fits hot set)</span>
                </div>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Eviction policy
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["lru", "clock"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setBufferPolicy(p)}
                      className={`rounded-md border px-2 py-1.5 text-[10px] font-medium ${
                        bufferPolicy === p
                          ? "border-emerald-500/70 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {p === "lru" ? "LRU" : "Clock sweep (2nd chance)"}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => void runEval()}
                disabled={busy}
                className="w-full rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? "Simulating…" : "Run the workload"}
              </button>
            </div>
          ) : null}

          {runError ? (
            <div className="shrink-0 border-t border-red-200 dark:border-red-900 bg-red-100 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {runError}
            </div>
          ) : null}
        </section>

        {/* right: visualizer + feedback */}
        <section className="flex flex-col lg:min-h-0">
          <div className="flex h-9 shrink-0 items-center border-b border-zinc-800 px-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Visualizer · {CATEGORY_LABEL[challenge.category]}
          </div>
          <div className="p-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <ChallengeView
              category={challenge.category}
              eval={eval_}
              sim={sim}
              simIdx={effSimIdx}
              onStep={(i) => setSimIdx(i)}
              onPlay={(p) => setSimPlaying(p)}
              playing={simPlaying}
              speed={simSpeed}
              setSpeed={setSimSpeed}
              frames={bufferFrames}
              submission={submission}
              solution={challenge.solution}
              queryAnalysis={queryAnalysis}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function ChallengeView(props: {
  category: string;
  eval: Evaluation | null;
  sim: ReturnType<typeof ConcurrencySim.prototype.run> | null;
  simIdx: number;
  onStep: (i: number) => void;
  onPlay: (p: boolean) => void;
  playing: boolean;
  speed: number;
  setSpeed: (n: number) => void;
  frames: number;
  submission: ChallengeSubmission;
  solution: string;
  queryAnalysis: QueryAnalysis | null;
}) {
  const { category, sim, simIdx, frames, solution, queryAnalysis } = props;
  const ev = props.eval;

  // The plan/btree capstones animate the *written query's* page reads: one
  // segment per touched table, SEQ vs INDEX from the static analysis.
  const readSegments = useMemo<ReadSegment[] | null>(() => {
    if (!queryAnalysis || queryAnalysis.tables.length === 0) return null;
    return analysisToSegments(queryAnalysis);
  }, [queryAnalysis]);

  if (category === "plan" || category === "btree") {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="flex h-[340px] shrink-0 flex-col justify-center rounded-lg border border-zinc-800 bg-zinc-950 px-4 text-center">
          {ev ? (
            <div className="space-y-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Page reads — closed-form I/O model
              </p>
              <div className="flex items-end justify-center gap-6 text-xs">
                <div>
                  <p className="font-mono text-[10px] text-zinc-500">before</p>
                  <p className="font-mono text-lg text-amber-700 dark:text-amber-300">{fmt(ev.baseline.reads)}</p>
                  {ev.baseline.reads > 0 ? (
                    <p className="font-mono text-[9px] text-zinc-600">≈ {(ev.baseline.reads * 0.1).toFixed(0)} ms</p>
                  ) : null}
                </div>
                <div>
                  <p className="font-mono text-[10px] text-zinc-500">after</p>
                  <p className={`font-mono text-lg ${ev.passed ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                    {fmt(ev.metrics.reads)}
                  </p>
                  {ev.metrics.reads > 0 ? (
                    <p className="font-mono text-[9px] text-emerald-600/80 dark:text-emerald-400/80">≈ {(ev.metrics.reads * 0.1).toFixed(1)} ms</p>
                  ) : null}
                </div>
              </div>
              <p className="text-[11px] leading-snug text-zinc-500">
                {ev.metrics.scanMode === "index"
                  ? "A B-Tree index seek replaces the sequential scan: pages drop from table-size to log(table-size)."
                  : "Still a sequential scan — pages equal the table size no matter how few rows match."}
              </p>
            </div>
          ) : (
            <p className="mx-auto max-w-xs text-[11px] leading-snug text-zinc-600">
              Grading uses a deterministic I/O model — reads are computed from the seeded row counts, no engine run.
              Press <span className="font-mono text-emerald-700 dark:text-emerald-500">Run &amp; check</span> to grade. (The live EXPLAIN
              plan is in the Query Plan lab.)
            </p>
          )}
        </div>
        {readSegments ? (
          <ReadsAnimation
            key={readSegments.map((s) => `${s.kind}:${s.label}:${s.pages}`).join("|")}
            segments={readSegments}
            title="Pages read while your query runs"
          />
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-[10px] leading-snug text-zinc-600">
            As you edit the query in the center pane, the animation above tracks
            which pages it reads — write an index-friendly query and watch the bars collapse.
          </p>
        )}
        {queryAnalysis ? (
          <QueryAnalysisPanel analysis={queryAnalysis} />
        ) : null}
        {ev ? <FeedbackPanel eval={ev} solution={solution} /> : null}
      </div>
    );
  }

  if (category === "buffer") {
    return (
      <div className="flex h-full flex-col gap-2">
        <SqlCaption
          title="Workload being animated"
          sql={`-- 320 accesses over order pages (deterministic trace)\nSELECT amount FROM orders WHERE order_id = ?;  /* 75% hot pages 0–7, 25% dirtying writes */`}
        />
        {ev?.payload.buffer ? (
          <BufferView run={ev.payload.buffer} frames={frames} />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-zinc-800 text-[11px] text-zinc-600">
            Run the workload to watch LRU vs Clock sweep over the access trace.
          </div>
        )}
        {ev ? <FeedbackPanel eval={ev} solution={solution} /> : null}
      </div>
    );
  }

  // concurrency
  if (!sim) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
        Loading transaction runner…
      </div>
    );
  }
  const cur = sim.steps[simIdx] ?? sim.steps[0];
  const sqlCaption =
    props.submission.kind === "isolation"
      ? `-- A (writer): UPDATE accounts SET balance = balance - 100 WHERE id = 1;\n-- B (reader): SELECT balance FROM accounts WHERE id = 1;`
      : `-- Mixed order: A locks row 1 → row 2, B locks row 2 → row 1\n-- A: UPDATE ... WHERE id = 1; then WHERE id = 2;\n-- B: UPDATE ... WHERE id = 2; then WHERE id = 1;`;
  return (
    <div className="flex h-full flex-col gap-2">
      <SqlCaption title="Statements being animated" sql={sqlCaption} />
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[10px] text-zinc-400">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{cur.txnId}</span> · {cur.label}
        </div>
        <div className="h-[200px]">
          <TimelineGrid
            steps={sim.steps.slice(0, simIdx + 1)}
            waitSpans={sim.summary.waitSpans.filter((w) => w.toStep <= simIdx)}
            clients={[...CLIENTS]}
          />
        </div>
      </div>
      <Transport
        idx={simIdx}
        max={sim.steps.length - 1}
        onStep={props.onStep}
        onPlay={props.onPlay}
        playing={props.playing}
        speed={props.speed}
        setSpeed={props.setSpeed}
      />
      <LockMonitor state={cur.state} />
        {ev ? <FeedbackPanel eval={ev} solution={solution} /> : null}
      </div>
    );
  }

function Transport(props: {
  idx: number;
  max: number;
  onStep: (i: number) => void;
  onPlay: (p: boolean) => void;
  playing: boolean;
  speed: number;
  setSpeed: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <button
        onClick={() => props.onStep(0)}
        className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
      >
        ⏮
      </button>
      <button
        onClick={() => props.onPlay(!props.playing)}
        disabled={props.idx >= props.max}
        className="rounded-md border border-emerald-600 bg-emerald-100 dark:bg-emerald-800/40 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:bg-emerald-800/70 disabled:opacity-40"
      >
        {props.playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <button
        onClick={() => props.onStep(Math.min(props.idx + 1, props.max))}
        disabled={props.idx >= props.max}
        className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
      >
        ▶|
      </button>
      <button
        onClick={() => props.onStep(Math.max(props.idx - 1, 0))}
        disabled={props.idx <= 0}
        className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
      >
        |◀
      </button>
      <div className="ml-1 flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-500">speed</span>
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.5}
          value={props.speed}
          onChange={(e) => props.setSpeed(Number(e.target.value))}
          className="w-20 accent-emerald-500"
        />
        <span className="font-mono text-[10px] text-zinc-400">{props.speed}×</span>
      </div>
      <span className="ml-auto font-mono text-[10px] text-zinc-500">
        step {props.idx}/{props.max}
      </span>
    </div>
  );
}

function BufferView({ run, frames }: { run: import("@/lib/engine/challengeEngine").BufferRun; frames: number }) {
  const pct = (n: number) => (run.accesses.length ? Math.round((n / run.accesses.length) * 100) : 0);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-[10px]">
        <span className="text-zinc-400">
          reads <span className="text-zinc-100">{run.reads}</span>
        </span>
        <span className="text-zinc-400">
          writes <span className="text-zinc-100">{run.writes}</span>
        </span>
        <span className="text-zinc-400">
          hits <span className="text-emerald-600 dark:text-emerald-400">{run.hits}</span>
        </span>
        <span className="text-zinc-400">
          miss rate <span className="text-rose-600 dark:text-rose-400">{pct(run.misses)}%</span>
        </span>
      </div>
      <div className="mb-1 text-[9px] font-mono uppercase tracking-wider text-zinc-600">
        buffer pool · {frames} frames
      </div>
      <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-0.5">
        {Array.from({ length: Math.max(frames, 16) }, (_, i) => {
          const page = i < frames ? itemPage(run, i) : null;
          return (
            <div
              key={i}
              className={`flex h-7 items-center justify-center rounded border font-mono text-[8px] ${
                page === null
                  ? "border-zinc-800 bg-zinc-950 text-zinc-600 dark:text-zinc-700"
                  : page.dirty
                    ? "border-amber-400/80 dark:border-amber-600/80 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                    : "border-emerald-400/70 dark:border-emerald-700/70 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
              }`}
              title={page ? `page ${page.page}${page.dirty ? " (dirty)" : ""}` : "empty frame"}
            >
              {page ? `p${page.page}` : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-2 mb-1 text-[9px] font-mono uppercase tracking-wider text-zinc-600">
        access trace · {run.accesses.length} ops (green = hit, red = disk read)
      </div>
      <div className="flex flex-wrap gap-0.5">
        {run.accesses.map((a, i) => (
          <span
            key={i}
            title={a.hit ? `page ${a.page} cache hit` : `page ${a.page} → disk${a.evicted !== null ? ` (evicted p${a.evicted})` : ""}`}
            className={`h-2 w-2 rounded-sm ${a.hit ? "bg-emerald-600/70" : "bg-rose-600/80"}`}
          />
        ))}
      </div>
    </div>
  );
}

function itemPage(run: import("@/lib/engine/challengeEngine").BufferRun, frame: number): { page: number; dirty: boolean } | null {
  // Recompute final frame occupancy by replaying the recorded accesses.
  const slots: (number | null)[] = Array.from({ length: 16 }, () => null);
  const dirtySet = new Set<number>();
  const lru = new Map<number, number>();
  for (let i = 0; i < run.accesses.length; i += 1) {
    const a = run.accesses[i];
    const at = slots.indexOf(a.page);
    if (at !== -1) {
      lru.set(a.page, i);
      if (!a.read) dirtySet.add(a.page);
      continue;
    }
    if (a.evicted !== null) {
      const at2 = slots.indexOf(a.evicted);
      if (at2 !== -1) {
        slots[at2] = null;
        dirtySet.delete(a.evicted);
        lru.delete(a.evicted);
      }
    }
    const free = slots.findIndex((p) => p === null);
    const target = free !== -1 ? free : 0;
    slots[target] = a.page;
    lru.set(a.page, i);
    if (!a.read) dirtySet.add(a.page);
  }
  const page = slots[frame];
  if (page === null) return null;
  return { page, dirty: dirtySet.has(page) };
}

function SqlCaption({ title, sql }: { title: string; sql: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
        {sql}
      </pre>
    </div>
  );
}

function FeedbackPanel({ eval: e, solution }: { eval: Evaluation; solution: string }) {
  const usesReads = e.baseline.reads > 0 && e.metrics.reads >= 0;
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        e.passed ? "border-emerald-400 dark:border-emerald-700 bg-emerald-100 dark:bg-emerald-950/40" : "border-rose-200 dark:border-rose-800 bg-rose-100 dark:bg-rose-950/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className={`font-mono text-[11px] font-bold uppercase ${e.passed ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
          {e.passed ? "✓ Challenge passed" : "✗ Not yet"}
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-400">efficiency {e.efficiency}</span>
          <span className="font-mono text-[10px] text-zinc-400">score {e.score}</span>
          {e.passed ? (
            <span className="text-[11px] text-amber-700 dark:text-amber-300">
              {"★".repeat(e.stars)}
              <span className="text-zinc-600 dark:text-zinc-700">{"★".repeat(3 - e.stars)}</span>
            </span>
          ) : null}
        </div>
      </div>

      {e.failures.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {e.failures.map((f, i) => (
            <li key={i} className="text-[10px] leading-snug text-rose-800/90 dark:text-rose-200/90">
              ⚠ {f}
            </li>
          ))}
        </ul>
      ) : null}

      {usesReads ? (
        <p className="mt-1.5 font-mono text-[9px] text-zinc-600">
          reads = ⌈rows ÷ 64⌉ (seq scan) or ⌈log₅₁₂ rows⌉ + 1 (index seek) · I/O ms = reads × 0.1
        </p>
      ) : null}

      {/* before / after diff */}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Metric label="Disk reads" before={fmtReads(e.baseline.reads)} after={fmtReads(e.metrics.reads)} ok={usedMetric(usesReads, e.metrics.reads <= e.baseline.reads)} />
        <Metric label="Est. I/O time" before={`${e.baseline.estimatedTimeMs.toFixed(1)} ms`} after={`${e.metrics.estimatedTimeMs.toFixed(1)} ms`} ok={usedMetric(usesReads, e.metrics.estimatedTimeMs <= e.baseline.estimatedTimeMs)} />
        <Metric label="Deadlocks" before={`${e.baseline.deadlocks}`} after={`${e.metrics.deadlocks}`} ok={e.metrics.deadlocks <= e.baseline.deadlocks} />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {e.assertionResults.map((a) => (
          <span
            key={a.kind}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
              a.passed ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300" : "bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300"
            }`}
            title={`${a.kind}: ${a.actual} vs ${a.target}`}
          >
            {a.passed ? "✓" : "✗"} {a.kind}
          </span>
        ))}
      </div>

      <p className="mt-2 rounded bg-zinc-950/60 p-2 text-[10px] leading-relaxed text-zinc-400">
        <span className="font-semibold text-zinc-200">First principles:</span>{" "}
        {e.failures.length === 0 ? (
          <>
            {solution}{" "}
            <span className="text-zinc-600">Now compare the before/after numbers — that is the cost of the broken approach.</span>
          </>
        ) : (
          "Read the hints — the diff bars tell you which direction to push."
        )}
      </p>
    </div>
  );
}

function usedMetric(usesReads: boolean, ok: boolean): boolean {
  return !usesReads || ok;
}

function fmtReads(n: number): string {
  return n > 0 ? new Intl.NumberFormat("en-US").format(n) : "—";
}

function Metric({ label, before, after, ok }: { label: string; before: string; after: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5">
      <p className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-mono text-[11px] ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-300"}`}>{after}</p>
      <p className="font-mono text-[9px] text-zinc-600 line-through">before {before}</p>
    </div>
  );
}