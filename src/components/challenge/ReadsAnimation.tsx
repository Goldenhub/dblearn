"use client";

/**
 * A tiny page-read "costometer" that animates what a written query actually
 * does to disk: each segment is one table access (SEQ vs INDEX), the sweep
 * reveals pages being read, and the cumulative counter keeps a running I/O
 * time at 0.1 ms/page. Purely presentational — the reads come from the static
 * QueryAnalysis / challenge model. Pure client component, no dependencies.
 *
 * NOTE: reset the animation by giving the component a changing `key` when the
 * query changes (the parent remounts it) — there is no setState-in-effect.
 */

import { useEffect, useState } from "react";

export interface ReadSegment {
  label: string;
  pages: number;
  kind: "seq" | "index" | "write";
}

const PAGE_IO_MS = 0.1;

function sqrtScale(pages: number, max: number): number {
  return Math.sqrt(Math.min(pages, max) / max) * 100;
}

export default function ReadsAnimation({
  segments,
  title = "Pages read while your query runs",
}: {
  segments: ReadSegment[];
  title?: string;
}) {
  const total = segments.reduce((n, s) => n + Math.max(0, s.pages), 0);
  const maxPages = Math.max(1, ...segments.map((s) => s.pages));

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const chunk = Math.max(1, Math.round(total / 160));
  const done = cursor >= total;
  const effPlaying = playing && !done;

  useEffect(() => {
    if (!effPlaying) return;
    const iv = setInterval(() => {
      setCursor((c) => Math.min(c + chunk, total));
    }, Math.max(40, Math.round(75 / speed)));
    return () => clearInterval(iv);
  }, [effPlaying, speed, chunk, total]);

  const onPlayPause = () => {
    if (done) setCursor(0);
    setPlaying((p) => !p);
  };

  // Cumulative page offsets so each segment can show its own fill.
  const offsets: number[] = [];
  let acc = 0;
  for (const s of segments) {
    offsets.push(acc);
    acc += Math.max(0, s.pages);
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          {title}
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          <span className="text-zinc-100">{fmt(cursor)}</span> / {fmt(total)} pages
          {cursor > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400"> ≈ {(cursor * PAGE_IO_MS).toFixed(1)} ms</span>
          ) : null}
        </p>
      </div>

      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
          style={{ width: `${total ? (cursor / total) * 100 : 0}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {segments.map((s, i) => {
          const off = offsets[i]!;
          const consumed = Math.max(0, Math.min(cursor - off, s.pages));
          const pct = s.pages ? consumed / s.pages : 1;
          const fillTone =
            s.kind === "index" ? "bg-emerald-500/80" : s.kind === "write" ? "bg-amber-500/70" : "bg-blue-500/70";
          return (
            <div key={i}>
              <div className="mb-0.5 flex items-center justify-between gap-2 font-mono text-[9px] text-zinc-500">
                <span className="truncate">
                  <span
                    className={`mr-1 rounded px-1 text-[8px] font-bold ${
                      s.kind === "index"
                        ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                        : s.kind === "write"
                          ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          : "bg-blue-900/40 text-blue-300"
                    }`}
                  >
                    {s.kind === "index" ? "IDX" : s.kind === "write" ? "WRT" : "SEQ"}
                  </span>
                  {s.label}
                </span>
                <span className="shrink-0">
                  {fmt(consumed)}/{fmt(s.pages)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-sm bg-zinc-800/80">
                <div
                  className={`h-full rounded-sm transition-[width] duration-75 ${fillTone}`}
                  style={{ width: `${pct * sqrtScale(s.pages, maxPages)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-800/80 pt-2">
        <button
          onClick={() => setCursor(0)}
          className="rounded-md border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 hover:border-zinc-500"
        >
          ⏮
        </button>
        <button
          onClick={onPlayPause}
          disabled={total === 0}
          className="rounded-md border border-emerald-400 dark:border-emerald-700 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:bg-emerald-900/70 disabled:opacity-40"
        >
          {effPlaying ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          onClick={() => setCursor((c) => Math.min(c + chunk, total))}
          disabled={done}
          className="rounded-md border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          ▶|
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-zinc-500">speed</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-16 accent-emerald-500"
          />
          <span className="font-mono text-[9px] text-zinc-400">{speed}×</span>
        </div>
      </div>

      <p className="mt-2 text-[9px] leading-snug text-zinc-600">
        seq = ⌈rows ÷ 64⌉ pages · index = ⌈log₅₁₂ rows⌉ + 1 pages · I/O = pages × 0.1 ms
      </p>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}