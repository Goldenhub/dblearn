"use client";

/**
 * Phase 5 — Concurrency Playground. Pick an anomaly scenario, then flip the
 * isolation level and execute. The engine re-runs the exact same global script
 * under the new level, so you see the anomaly appear as a dirty/repeat/phantom
 * red ⚠ — or collapse into lock waits, range locks and full serializability.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ConcurrencySim,
  SCENARIOS,
  isolationLabel,
  isolationSummary,
  type ClientId,
  type IsolationLevel,
} from "@/lib/engine/concurrency";
import TimelineGrid from "./TimelineGrid";
import LockMonitor from "./LockMonitor";

const CLIENTS: ClientId[] = ["A", "B", "C"];
const BASE_MS = 650;

export default function ConcurrencyPlayground() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [isolation, setIsolation] = useState<IsolationLevel>(
    SCENARIOS[0].recommended,
  );
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const scenario = useMemo(() => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0], [scenarioId]);
  const { steps, summary } = useMemo(
    () => new ConcurrencySim({ isolation, events: scenario.events }).run(),
    [scenario, isolation],
  );

  const effIdx = Math.min(idx, steps.length - 1);
  const cur = steps[effIdx];
  const state = cur?.state;
  const visibleSpans = useMemo(
    () => summary.waitSpans.filter((w) => w.toStep <= effIdx),
    [summary, effIdx],
  );
  const seenAnomalies = useMemo(
    () => steps.slice(0, effIdx + 1).flatMap((s) => (s.anomaly ? [s] : [])),
    [steps, effIdx],
  );
  const pendingAnomalies = useMemo(
    () => steps.slice(effIdx + 1).filter((s) => s.anomaly).length,
    [steps, effIdx],
  );

  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setIdx((i) => {
        if (i >= steps.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, BASE_MS / speed);
    return () => clearInterval(iv);
  }, [playing, speed, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        setIdx((i) => Math.min(i + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft") {
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Home") {
        setIdx(0);
      } else if (e.key === "End") {
        setIdx(steps.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  const rule = (s: ClientId) =>
    s === "A" ? "border-sky-500" : s === "B" ? "border-violet-500" : "border-emerald-500";

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-7xl space-y-3 p-3">
        {/* scenario + isolation */}
        <div className="grid gap-3 lg:grid-cols-[1fr_230px]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Anomaly Scenario
            </p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {SCENARIOS.map((sc) => {
                const active = sc.id === scenarioId;
                return (
                  <button
                    key={sc.id}
                    onClick={() => {
                      setScenarioId(sc.id);
                      setIsolation(sc.recommended);
                      setIdx(0);
                      setPlaying(false);
                    }}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      active
                        ? "border-emerald-500/70 bg-emerald-100 dark:bg-emerald-950/40"
                        : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                    }`}
                  >
                    <p className={`text-[11px] font-semibold leading-tight ${active ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-200"}`}>
                      {sc.title}
                    </p>
                    <p className="mt-1 text-[9px] leading-snug text-zinc-500">{sc.description}</p>
                    <p className="mt-1.5 font-mono text-[9px] text-zinc-500">
                      run under <span className="text-amber-600 dark:text-amber-400">{isolationLabel(sc.recommended)}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Isolation Level
            </label>
            <select
              value={isolation}
              onChange={(e) => {
                setIsolation(e.target.value as IsolationLevel);
                setIdx(0);
                setPlaying(false);
              }}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
            >
              {(["read_uncommitted", "read_committed", "repeatable_read", "serializable"] as IsolationLevel[]).map(
                (lv) => (
                  <option key={lv} value={lv}>
                    {isolationLabel(lv)}
                  </option>
                ),
              )}
            </select>
            <p className="mt-2 text-[10px] leading-snug text-zinc-500">{isolationSummary(isolation)}</p>
            <div className="mt-3 rounded border border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-100 dark:bg-emerald-950/30 p-2 text-[10px] leading-relaxed text-emerald-800 dark:text-emerald-200">
              Re-executes the same global script from step 0 — only the locking rules change.
            </div>
          </div>
        </div>

        {/* transport */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <button
            onClick={() => {
              setIdx(0);
              setPlaying(false);
            }}
            title="Jump to start"
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500"
          >
            ⏮
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={idx >= steps.length - 1}
            className="rounded-md border border-emerald-600 bg-emerald-100 dark:bg-emerald-800/40 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:bg-emerald-800/70 disabled:opacity-40"
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={() => setIdx((i) => Math.min(i + 1, steps.length - 1))}
            disabled={idx >= steps.length - 1}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
          >
            Step ▶|
          </button>
          <button
            onClick={() => setIdx((i) => Math.max(i - 1, 0))}
            disabled={idx <= 0}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
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
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-24 accent-emerald-500"
            />
            <span className="font-mono text-[10px] text-zinc-400">{speed}×</span>
          </div>
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            step {idx}/{steps.length - 1} · space play/pause
          </span>
        </div>

        {cur ? (
          <>
            {/* timeline + right rail */}
            <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950">
                <div className="border-b border-zinc-800 px-3 py-2 font-mono text-[10px] text-zinc-400">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{cur.txnId}</span> · {cur.label}
                </div>
                <div className="h-[236px]">
                  <TimelineGrid steps={steps.slice(0, effIdx + 1)} waitSpans={visibleSpans} clients={CLIENTS} />
                </div>
              </div>

              <div className="space-y-3">
                <LockMonitor state={state} />
              </div>
            </div>

            {/* observations + rows */}
            <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Anomalies detected
                  </p>
                  {pendingAnomalies > 0 ? (
                    <span className="font-mono text-[10px] text-zinc-500">
                      +{pendingAnomalies} more ahead
                    </span>
                  ) : null}
                </div>
                {seenAnomalies.length === 0 ? (
                  <p className="text-[11px] text-zinc-600">
                    No anomalies yet. {summary.anomalies.length === 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        This level blocks the ambiguity — keep playing to watch the waits.
                      </span>
                    ) : (
                      "Keep stepping to reach the flagged operation."
                    )}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {seenAnomalies.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-start gap-2 rounded-md border border-rose-200/70 dark:border-rose-900/70 bg-rose-100 dark:bg-rose-950/40 px-2.5 py-1.5"
                      >
                        <span className="mt-0.5 text-rose-600 dark:text-rose-400">⚠</span>
                        <div>
                          <p className="font-mono text-[10px] font-bold uppercase text-rose-700 dark:text-rose-300">{s.anomaly}</p>
                          <p className="text-[10px] leading-snug text-rose-800/80 dark:text-rose-200/80">{s.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-[10px] leading-relaxed text-zinc-400">
                  <span className="font-semibold text-zinc-200">First principles:</span> strict
                  two-phase locking — every lock is taken in a growing phase and held to
                  COMMIT (writes always; reads depend on isolation). A block is the database
                  trading throughput for correctness; the Wait-For Graph aborts the requester
                  that closes a cycle so a deadlock can never stall the system.
                </div>
              </div>

              {/* committed rows + dirty overlays */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  accounts table (id → balance)
                </p>
                <div className="space-y-1">
                  {state.rows.map((r) => {
                    const dirty = state.dirty.find((d) => d.rowId === r.id);
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center justify-between rounded px-2 py-1 font-mono text-[11px] border-l-2 ${
                          dirty
                            ? `border-rose-500 bg-rose-100 dark:bg-rose-950/40 ${rule(dirty.txnId)}`
                            : "border-zinc-700 bg-zinc-950 text-zinc-400"
                        }`}
                      >
                        <span>account[{r.id}]</span>
                        {dirty ? (
                          <span className="text-rose-700 dark:text-rose-300">
                            {r.value} → {dirty.value}
                            <span className="ml-1 text-[9px] text-zinc-500">dirty·{dirty.txnId}</span>
                          </span>
                        ) : (
                          <span>{r.value}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[9px] leading-snug text-zinc-600">
                  Rose = uncommitted write visible only to Read Uncommitted. Everything else reads
                  the committed page.
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-600">Loading scenario…</p>
        )}
      </div>
    </div>
  );
}