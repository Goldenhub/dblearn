"use client";

/**
 * Phase 5 — live lock monitor. Left: granted locks and the wait queue for each
 * resource. Right: the Wait-For Graph (an edge A→B reads "A waits on B"). If a
 * cycle exists its nodes glow red — that is the deadlock the engine aborts.
 */

import type { ConcurrencyState } from "@/lib/engine/concurrency";

const NODE_POS: Record<string, { x: number; y: number }> = {
  A: { x: 92, y: 6 },
  B: { x: 26, y: 104 },
  C: { x: 158, y: 104 },
};

function findCycleNodes(edges: { from: string; to: string }[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const color = new Map<string, number>();
  let cycle: string[] = [];
  const stack: string[] = [];
  const dfs = (u: string): boolean => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) {
        const idx = stack.indexOf(v);
        cycle = stack.slice(idx);
        return true;
      }
      if ((color.get(v) ?? 0) === 0 && dfs(v)) return true;
    }
    stack.pop();
    color.set(u, 2);
    return false;
  };
  for (const u of new Set(edges.map((e) => e.from))) {
    if ((color.get(u) ?? 0) === 0 && dfs(u)) break;
  }
  return new Set(cycle);
}

export default function LockMonitor({ state }: { state: ConcurrencyState }) {
  const cycle = findCycleNodes(state.waitFor);
  const holders = new Map<string, { mode: string; txnId: string }[]>();
  for (const g of state.granted) {
    holders.set(g.resourceId, [...(holders.get(g.resourceId) ?? []), { mode: g.mode, txnId: g.txnId }]);
  }
  const resources = new Set<string>([
    ...state.granted.map((g) => g.resourceId),
    ...state.queue.map((q) => q.resourceId),
    ...state.rangeLocks.map((r) => `range[${r.lo}..${r.hi}]${r.strong ? "⊕" : ""}`),
  ]);

  const graphNodes = Object.keys(NODE_POS).filter((t) =>
    state.txns.some((x) => x.id === t),
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Holds &amp; Wait Queue
        </p>
        {resources.size === 0 ? (
          <p className="text-[11px] text-zinc-600">No locks held or requested yet.</p>
        ) : (
          <div className="space-y-2">
            {[...resources].map((res) => {
              const held = holders.get(res) ?? [];
              const queued = state.queue.filter((q) => q.resourceId === res);
              return (
                <div key={res} className="rounded border border-zinc-800 bg-zinc-950 p-2">
                  <div className="grid grid-cols-[88px_1fr] gap-2 text-[10px]">
                    <span className="font-mono text-zinc-300">{res}</span>
                    <div className="space-y-1">
                      {held.length === 0 && queued.length === 0 ? (
                        <span className="text-zinc-600">—</span>
                      ) : null}
                      {held.map((h, i) => (
                        <span
                          key={`h-${i}`}
                          className={`mr-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono ${
                            h.mode === "X"
                              ? "bg-amber-200 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300"
                              : "bg-sky-200 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300"
                          }`}
                        >
                          {h.mode}·{h.txnId}
                        </span>
                      ))}
                      {queued.map((q, i) => (
                        <span
                          key={`q-${i}`}
                          className="inline-flex items-center gap-1 rounded border border-dashed border-amber-400/60 dark:border-amber-600/60 px-1.5 py-0.5 font-mono text-amber-600/90 dark:text-amber-400/90"
                        >
                          wait {q.mode}·{q.txnId}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Wait-For Graph
        </p>
        {state.waitFor.length === 0 ? (
          <p className="text-[11px] text-zinc-600">
            Nobody is waiting — no lock contention.
          </p>
        ) : (
          <>
            <p className="mb-1 text-[10px] text-zinc-500">
              edge {`A→B`} = {`A`} is blocked by {`B`}.
            </p>
            <svg viewBox="0 0 196 132" className="w-full">
              {state.waitFor.map((e, i) => {
                const a = NODE_POS[e.from];
                const b = NODE_POS[e.to];
                const cyc = cycle.has(e.from) && cycle.has(e.to);
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={cyc ? "#f43f5e" : "#f59e0b"}
                    strokeWidth={cyc ? 2 : 1.25}
                    strokeDasharray={cyc ? "none" : "4 3"}
                    markerEnd={`url(#arrow${cyc ? "Rose" : "Amber"})`}
                  />
                );
              })}
              <defs>
                <marker id="arrowAmber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 10 5 0 10z" fill="#f59e0b" />
                </marker>
                <marker id="arrowRose" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 10 5 0 10z" fill="#f43f5e" />
                </marker>
              </defs>
              {graphNodes.map((t) => {
                const waiting = state.txns.find((x) => x.id === t)?.waitingOn;
                const inCycle = cycle.has(t);
                return (
                  <g key={t}>
                    <circle
                      cx={NODE_POS[t].x}
                      cy={NODE_POS[t].y}
                      r={16}
                      fill={inCycle ? "#4c0519" : waiting ? "#78350f" : "#18181b"}
                      stroke={inCycle ? "#f43f5e" : waiting ? "#f59e0b" : "#3f3f46"}
                      strokeWidth={inCycle ? 2 : 1}
                    />
                    <text
                      x={NODE_POS[t].x}
                      y={NODE_POS[t].y + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill={inCycle ? "#fda4af" : "#e4e4e7"}
                    >
                      {t}
                    </text>
                  </g>
                );
              })}
            </svg>
            {cycle.size > 0 ? (
              <p className="mt-1 font-mono text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                ⚡ CYCLE: {[...cycle].join(" → ")} → {[...cycle][0]} — engine aborts the
                last requester.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}