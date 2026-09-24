"use client";

/**
 * Phase 3 — B-Tree playground: owns the engine instance, the recorded
 * per-operation step history and its playback transport, plus the
 * side-by-side O(log N) vs O(N) proof panel, page-fill/overhead stats and a
 * first-principles callout.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BTree,
  snapshotStats,
  insertRandomKeys,
  type BTreeDegree,
  type BTreeStep,
  type SearchResult,
} from "@/lib/engine/btree";
import BTreeCanvas, { stepAccent } from "@/components/btree/BTreeCanvas";
import BTreeControls from "@/components/btree/BTreeControls";
import { labOpened } from "@/lib/dblearnlytics";

const BASE_MS = 620;

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 ${className}`}
    >
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CompareBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-zinc-400">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-zinc-100">{value}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

export default function BTreePlayground() {
  const [degree, setDegreeState] = useState<BTreeDegree>(2);
  const [tree, setTree] = useState(() => new BTree(degree));
  const [steps, setSteps] = useState<BTreeStep[]>([]);
  const [playIndex, setPlayIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);

  const commitSteps = useCallback(
    (newSteps: BTreeStep[], resetSearch: boolean) => {
      const combined =
        steps.length === 0 ? newSteps : [...steps, ...newSteps.slice(1)];
      setSteps(combined);
      setPlayIndex(combined.length - 1);
      if (resetSearch) setSearchResult(null);
    },
    [steps],
  );

  const handleInsert = (key: number) => {
    setPlaying(false);
    const res = tree.insert(key);
    commitSteps(res.steps, true);
  };

  const handleBatch = (count: number) => {
    setPlaying(false);
    const { steps: batchSteps, inserted } = insertRandomKeys(tree, count);
    if (inserted === 0) {
      setSearchResult(null);
      return;
    }
    commitSteps(batchSteps, true);
  };

  const handleDelete = (key: number) => {
    setPlaying(false);
    const res = tree.delete(key);
    commitSteps(res.steps, true);
  };

  const handleSearch = (key: number) => {
    setPlaying(false);
    const { steps: searchSteps, result } = tree.search(key);
    commitSteps(searchSteps, false);
    setSearchResult(result);
  };

  const handleDegreeChange = (t: BTreeDegree) => {
    setPlaying(false);
    setDegreeState(t);
    setTree(new BTree(t));
    setSteps([]);
    setPlayIndex(-1);
    setSearchResult(null);
  };

  const handleClear = () => {
    setPlaying(false);
    setTree(new BTree(degree));
    setSteps([]);
    setPlayIndex(-1);
    setSearchResult(null);
  };

  const stepForward = useCallback(() => {
    setPlayIndex((i) => Math.min(steps.length - 1, i + 1));
  }, [steps.length]);

  const stepBack = useCallback(() => {
    setPlayIndex((i) => Math.max(-1, i - 1));
  }, []);

  const handlePlayToggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && playIndex >= steps.length - 1) setPlayIndex(-1);
      return !p;
    });
  }, [playIndex, steps.length]);

  useEffect(() => {
    labOpened("btree");
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id =
      playIndex >= steps.length - 1
        ? window.setTimeout(() => setPlaying(false), 0)
        : window.setTimeout(
            () => setPlayIndex((i) => Math.min(steps.length - 1, i + 1)),
            BASE_MS / speed,
          );
    return () => window.clearTimeout(id);
  }, [playing, playIndex, steps.length, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === " ") {
        e.preventDefault();
        handlePlayToggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepForward();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlePlayToggle, stepForward, stepBack]);

  const current = playIndex >= 0 && playIndex < steps.length ? steps[playIndex] : null;
  const snapshot = current ? current.snapshot : tree.snapshot();
  const active = current?.active ?? null;
  const pathIds = current?.pathIds ?? [];
  const kind = current?.kind ?? "start";
  const statusText = current?.label ?? (steps.length ? steps[steps.length - 1].label : "ready — insert or search to start");

  const stats = useMemo(() => snapshotStats(snapshot), [snapshot]);
  const accent = stepAccent(kind);
  const hops = searchResult?.hops ?? 0;
  const seqSteps = searchResult?.seqSteps ?? 0;
  const compareMax = Math.max(hops, seqSteps, 1);

  return (
    <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-full lg:overflow-hidden">
      <BTreeControls
        degree={degree}
        onDegreeChange={handleDegreeChange}
        onInsert={handleInsert}
        onInsertBatch={handleBatch}
        onDelete={handleDelete}
        onSearch={handleSearch}
        onClear={handleClear}
        stepIndex={current ? playIndex : -1}
        stepCount={steps.length}
        playing={playing}
        speed={speed}
        onPlayToggle={handlePlayToggle}
        onStepBack={stepBack}
        onStepForward={stepForward}
        onStepStart={() => setPlayIndex(-1)}
        onStepEnd={() => setPlayIndex(steps.length - 1)}
        onSpeedChange={setSpeed}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="relative h-[46vh] min-h-[260px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 lg:h-auto lg:min-h-0 lg:flex-1">
          <BTreeCanvas snapshot={snapshot} active={active} pathIds={pathIds} kind={kind} />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-1.5">
            <div className={`text-[11px] font-medium ${accent.text}`}>{statusText}</div>
            <div className="font-mono text-[9px] text-zinc-500">
              {snapshot.totalKeys} keys · {snapshot.nodes.length} pages · height {snapshot.height}
            </div>
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-3 lg:w-[300px] lg:overflow-y-auto lg:pr-1">
          <Card title="Index vs sequential scan">
            <div className="space-y-2">
              <CompareBar
                label="B-Tree hops"
                value={hops}
                max={compareMax}
                color="bg-emerald-500"
              />
              <CompareBar
                label="Seq. key steps"
                value={seqSteps}
                max={compareMax}
                color="bg-rose-500"
              />
              <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                A lookup touches only the pages on one pointer path: about{" "}
                <span className="font-mono text-emerald-600 dark:text-emerald-400">log₂″ N</span>{" "}
                hops instead of reading every key in order. With N ={" "}
                {snapshot.totalKeys} you trade{" "}
                <span className="font-mono text-zinc-300">{hops}</span> page
                reads for{" "}
                <span className="font-mono text-zinc-300">{seqSteps}</span>{" "}
                sequential steps.
              </p>
            </div>
          </Card>

          <Card title="Page-fill & overhead">
            <div className="grid grid-cols-2 gap-1.5">
              <StatCell label="Keys (N)" value={String(stats.keyCount)} />
              <StatCell label="Pages" value={String(stats.nodeCount)} />
              <StatCell label="Height" value={String(stats.height)} />
              <StatCell label="Avg fill" value={`${stats.avgFillPct.toFixed(0)}%`} />
              <StatCell label="Min / Max fill" value={`${stats.minFillPct.toFixed(0)}% / ${stats.maxFillPct.toFixed(0)}%`} />
              <StatCell label="Est. index size" value={`≈${(stats.estBytes / 1024).toFixed(2)} KB`} />
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${stats.avgFillPct}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-600">
                avg {stats.avgFillPct.toFixed(0)}% of the {snapshot.config.maxKeys}-key
                capacity per page
              </p>
            </div>
          </Card>

          <Card title="First-principles">
            <ul className="space-y-2 text-[11px] leading-5 text-zinc-400">
              <li>
                <span className="text-zinc-200">One page = one disk read.</span>{" "}
                Each hop in the animation below is a pointer that lands you on a
                single ~8 KB page — the database only ever fetches the pages on
                this path.
              </li>
              <li>
                <span className="text-zinc-200">2t − 1 is the split threshold.</span>{" "}
                A page overflows at <span className="font-mono">{snapshot.config.maxKeys}</span>{" "}
                keys (= 2×{degree} − 1); splitting promotes the median so every
                page stays {degree - 1}…2{degree} − 1 keys full. That fill rule
                caps height at O(log N).
              </li>
              <li>
                <span className="text-zinc-200">Fill factor is real memory.</span>{" "}
                Internal pages sacrifice one child-pointer slot per key, and pages
                below full capacity waste write space — the stats panel shows the
                trade-off you pay to get log-time reads.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}