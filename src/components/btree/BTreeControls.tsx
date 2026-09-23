"use client";

/**
 * Phase 3 — control bar for the B-Tree playground: single/batch inserts,
 * delete, search, degree selector, and the playback transport (play/pause/
 * step/speed) that rewinds and replays recorded operations.
 */

import { useState, type FormEvent } from "react";
import type { BTreeDegree } from "@/lib/engine/btree";

interface BTreeControlsProps {
  degree: BTreeDegree;
  onDegreeChange: (t: BTreeDegree) => void;
  onInsert: (key: number) => void;
  onInsertBatch: (count: number) => void;
  onDelete: (key: number) => void;
  onSearch: (key: number) => void;
  onClear: () => void;
  stepIndex: number;
  stepCount: number;
  playing: boolean;
  speed: number;
  onPlayToggle: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onStepStart: () => void;
  onStepEnd: () => void;
  onSpeedChange: (speed: number) => void;
}

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-600";
const labelCls = "text-[10px] font-medium uppercase tracking-wider text-zinc-500";
const btnBase =
  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors";
const btnPrimary = `${btnBase} border-emerald-600 bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600/30`;
const btnGhost = `${btnBase} border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800`;
const btnActive = `${btnBase} border-emerald-500 bg-emerald-600/15 text-emerald-700 dark:text-emerald-300`;

function Field({
  label,
  value,
  onChange,
  buttonLabel,
  onAction,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  buttonLabel: string;
  onAction: () => void;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAction();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <div className="flex gap-1.5">
        <input
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="key"
          inputMode="numeric"
        />
        <button type="submit" className={`${btnPrimary} shrink-0`}>
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}

function PlayButton({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${btnGhost} px-2 disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export default function BTreeControls({
  degree,
  onDegreeChange,
  onInsert,
  onInsertBatch,
  onDelete,
  onSearch,
  onClear,
  stepIndex,
  stepCount,
  playing,
  speed,
  onPlayToggle,
  onStepBack,
  onStepForward,
  onStepStart,
  onStepEnd,
  onSpeedChange,
}: BTreeControlsProps) {
  const [insertKey, setInsertKey] = useState("");
  const [batchCount, setBatchCount] = useState("20");
  const [deleteKey, setDeleteKey] = useState("");
  const [searchKey, setSearchKey] = useState("");

  const parseKey = (v: string): number | null => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const run = (v: string, action: (n: number) => void): void => {
    const n = parseKey(v);
    if (n !== null) action(n);
  };

  const batch = parseKey(batchCount);
  const atStart = stepIndex <= 0;
  const atEnd = stepIndex >= stepCount - 1;
  const hasSteps = stepCount > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field
          label="Insert"
          value={insertKey}
          onChange={setInsertKey}
          buttonLabel="Add"
          onAction={() => {
            run(insertKey, (n) => {
              onInsert(n);
              setInsertKey("");
            });
          }}
        />
        <Field
          label="Random batch"
          value={batchCount}
          onChange={setBatchCount}
          buttonLabel="Fill"
          onAction={() => {
            if (batch !== null && batch > 0) onInsertBatch(Math.min(batch, 60));
          }}
        />
        <Field
          label="Delete"
          value={deleteKey}
          onChange={setDeleteKey}
          buttonLabel="Drop"
          onAction={() => {
            run(deleteKey, (n) => {
              onDelete(n);
              setDeleteKey("");
            });
          }}
        />
        <Field
          label="Lookup"
          value={searchKey}
          onChange={setSearchKey}
          buttonLabel="Find"
          onAction={() => {
            run(searchKey, (n) => {
              onSearch(n);
              setSearchKey("");
            });
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Degree t (pages hold t−1 … 2t−1 keys)</span>
          <div className="flex gap-1.5">
            {([2, 3] as const).map((t) => (
              <button
                key={t}
                onClick={() => onDegreeChange(t)}
                className={t === degree ? btnActive : btnGhost}
              >
                t = {t}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClear} className={btnGhost}>
          Reset tree
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
        <PlayButton onClick={onStepStart} disabled={!hasSteps || atStart} title="Jump to start">
          ⏮
        </PlayButton>
        <PlayButton onClick={onStepBack} disabled={!hasSteps || atStart} title="Step back">
          ◀
        </PlayButton>
        <button
          onClick={onPlayToggle}
          disabled={!hasSteps}
          className={`${btnGhost} min-w-[72px] disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <PlayButton onClick={onStepForward} disabled={!hasSteps || atEnd} title="Step forward">
          ▶
        </PlayButton>
        <PlayButton onClick={onStepEnd} disabled={!hasSteps || atEnd} title="Jump to end">
          ⏭
        </PlayButton>
        <span className="ml-1 font-mono text-[11px] text-zinc-400">
          step {stepCount === 0 ? 0 : stepIndex + 1}/{stepCount}
        </span>
        <label className="ml-auto flex items-center gap-2 text-[10px] text-zinc-500">
          speed
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.5}
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer accent-emerald-500"
          />
          <span className="w-8 font-mono text-zinc-300">{speed}×</span>
        </label>
      </div>
    </div>
  );
}