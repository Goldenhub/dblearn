"use client";

/**
 * Phase 5 — multi-transaction timeline. One horizontal lane per client (A/B/C);
 * x = chronological step. Each op renders as a chip on its owner's lane, waits
 * render as dashed spans (from a recorded WaitSpan), and anomaly steps get a
 * red ⚠ ring. Hover any chip for the full engine label.
 */

import type { ClientId, ConcurrencyStep, StepKind } from "@/lib/engine/concurrency";

const COL_W = 44;
const ROW_H = 58;
const HEAD_H = 26;
const LANE_LABEL_W = 44;

interface Props {
  steps: ConcurrencyStep[];
  waitSpans: { txnId: ClientId; fromStep: number; toStep: number; resourceId: string }[];
  clients: ClientId[];
}

function chipStyle(kind: StepKind, anomaly: boolean): string {
  const base =
    "flex h-6 min-w-11 items-center justify-center rounded-md border px-1.5 font-mono text-[9px] font-semibold transition-colors";
  let tone: string;
  switch (kind) {
    case "begin":
      tone = "border-zinc-700 bg-zinc-800/80 text-zinc-300";
      break;
    case "read":
      tone = "border-sky-300 dark:border-sky-700 bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300";
      break;
    case "scan":
      tone = "border-cyan-300 dark:border-cyan-700 bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-300";
      break;
    case "write":
      tone = "border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300";
      break;
    case "insert":
      tone = "border-orange-300 dark:border-orange-700 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300";
      break;
    case "commit":
      tone = "border-emerald-400 dark:border-emerald-700 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300";
      break;
    case "rollback":
      tone = "border-zinc-600 bg-zinc-800 text-zinc-400";
      break;
    case "abort":
      tone = "border-rose-300 dark:border-rose-700 bg-rose-200 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300";
      break;
    case "lock-wait":
      tone = "border-dashed border-amber-400/60 dark:border-amber-600/60 bg-transparent text-amber-600 dark:text-amber-400";
      break;
    case "deadlock":
      tone = "border-rose-500 bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300";
      break;
    default:
      tone = "border-zinc-700 bg-zinc-800 text-zinc-400";
  }
  return `${base} ${tone}${anomaly ? " ring-2 ring-rose-500/70" : ""}`;
}

function chipLabel(s: ConcurrencyStep): string {
  switch (s.kind) {
    case "begin":
      return "BEGIN";
    case "read":
      return `r${s.read?.rowId}`;
    case "scan":
      return "SCAN";
    case "write":
      return `w${s.lock?.resourceId.replace("row:", "")}`;
    case "insert":
      return `+${s.lock?.resourceId.replace("row:", "")}`;
    case "commit":
      return "CMT";
    case "rollback":
      return "RB";
    case "abort":
      return "ABORT";
    case "lock-wait":
      return "wait";
    case "deadlock":
      return "⚡";
  }
}

export default function TimelineGrid({ steps, waitSpans, clients }: Props) {
  const width = Math.max(steps.length * COL_W + COL_W, 560);
  const byTxn = new Map<ClientId, ConcurrencyStep[]>();
  for (const c of clients) byTxn.set(c, []);
  for (const s of steps) byTxn.get(s.txnId)?.push(s);
  const spansByTxn = new Map<ClientId, Props["waitSpans"]>();
  for (const c of clients) spansByTxn.set(c, []);
  for (const w of waitSpans) spansByTxn.get(w.txnId)?.push(w);

  return (
    <div className="h-full w-full overflow-auto bg-zinc-950">
      <div className="relative" style={{ width, height: HEAD_H + ROW_H * clients.length }}>
        {/* step header */}
        <div
          className="absolute top-0 flex border-b border-zinc-800"
          style={{ left: LANE_LABEL_W, width: width - LANE_LABEL_W, height: HEAD_H }}
        >
          {steps.map((s) => (
            <div
              key={s.id}
              className="shrink-0 border-r border-zinc-700/60 dark:border-zinc-900/60 text-center font-mono text-[8px] leading-[26px] text-zinc-600 dark:text-zinc-700"
              style={{ width: COL_W }}
            >
              {s.id}
            </div>
          ))}
        </div>

        {clients.map((c, lane) => {
          const laneTop = HEAD_H + lane * ROW_H;
          return (
            <div key={c} className="absolute left-0 right-0" style={{ top: laneTop, height: ROW_H }}>
              <div
                className="absolute top-0 flex items-center justify-center border-r border-zinc-800 font-mono text-xs font-bold"
                style={{ left: 0, width: LANE_LABEL_W, height: ROW_H }}
              >
                <span
                  className={
                    c === "A"
                      ? "text-sky-700 dark:text-sky-400"
                      : c === "B"
                        ? "text-violet-700 dark:text-violet-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {c}
                </span>
              </div>
              {spansByTxn.get(c)!.map((sp, i) => (
                <div
                  key={`span-${i}`}
                  className="absolute top-4 h-1.5 rounded-full border border-dashed border-amber-400/70 dark:border-amber-500/70 bg-amber-500/15"
                  style={{
                    left: LANE_LABEL_W + sp.fromStep * COL_W + 2,
                    width: Math.max((sp.toStep - sp.fromStep + 1) * COL_W - 4, 8),
                  }}
                  title={`${c} waited on ${sp.resourceId} steps ${sp.fromStep}→${sp.toStep}`}
                />
              ))}
              {byTxn.get(c)!.map((s) => (
                <div
                  key={s.id}
                  className="absolute top-[13px]"
                  title={s.label}
                  style={{ left: LANE_LABEL_W + s.id * COL_W + (COL_W - 44) / 2 }}
                >
                  <div className={chipStyle(s.kind, s.anomaly !== null)}>
                    {chipLabel(s)}
                    {s.anomaly !== null ? <span className="ml-0.5 text-rose-600 dark:text-rose-400">⚠</span> : null}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}