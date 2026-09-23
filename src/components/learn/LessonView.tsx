"use client";

/**
 * One lesson: prose blocks, first-principles callouts, a small auto-graded
 * task, and (optionally) a production capstone that deep-links into the
 * Challenge workspace. Passing the task records the lesson in the progress
 * store; capstone lessons complete when the matching challenge is solved.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  COURSE_LESSONS,
  UNITS,
  lessonFor,
  type LessonBlock,
} from "@/lib/lessons/curriculum";
import { challengeFor } from "@/lib/challenges/catalog";
import {
  gradeTask,
  type LessonTask,
  type SqlTask,
  type TaskResult,
} from "@/lib/lessons/taskEngine";
import type { QueryAnalysis } from "@/lib/lessons/queryAnalyzer";
import { analysisToSegments } from "@/lib/lessons/queryAnalyzer";
import type { EvictionPolicy } from "@/lib/engine/challengeEngine";
import type { IsolationLevel } from "@/lib/engine/concurrency";
import {
  lessonCompleted,
  recordLesson,
  useProgress,
} from "@/lib/store/useProgressStore";
import QueryAnalysisPanel from "./QueryAnalysisPanel";
import ReadsAnimation from "@/components/challenge/ReadsAnimation";

const ISOLATIONS: { value: IsolationLevel; label: string }[] = [
  { value: "read_uncommitted", label: "READ UNCOMMITTED" },
  { value: "read_committed", label: "READ COMMITTED" },
  { value: "repeatable_read", label: "REPEATABLE READ" },
  { value: "serializable", label: "SERIALIZABLE" },
];

/** Minimal inline renderer: **bold**, `code`, $math$, and paragraph blocks. */
export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++} className="font-semibold text-zinc-100">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.9em] text-emerald-700 dark:text-emerald-300">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <span key={key++} className="font-mono text-[0.92em] text-amber-800/90 dark:text-amber-200/90">
          {token.slice(1, -1)}
        </span>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

function Prose({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-zinc-300">
      {markdown.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>{renderInline(para.replace(/\n/g, " "))}</p>
      ))}
    </div>
  );
}

function Callout({ title, body }: { title: string; body: string }) {
  return (
    <aside className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-100 dark:bg-sky-950/30 px-4 py-3">
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">{title}</h4>
      <p className="text-sm leading-relaxed text-zinc-300">{body}</p>
    </aside>
  );
}

function NumberInputTask({ onCheck }: { onCheck: (value: number) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCheck(Number(value));
          }}
          placeholder="pages"
          className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-600"
        />
        <button
          onClick={() => onCheck(Number(value))}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Check
        </button>
      </label>
    </div>
  );
}

function ChoiceTask({
  options,
  selected,
  onPick,
}: {
  options: { id: string; label: string }[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onPick(o.id)}
          className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
            selected === o.id
              ? "border-emerald-600 bg-emerald-500/10 text-zinc-100"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WorkedCalc({ lines }: { lines: string[] }) {
  return (
    <div className="mt-3 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-100 dark:bg-sky-950/20 px-3 py-2">
      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
        {"How it's calculated"}
      </p>
      <ol className="space-y-0.5 font-mono text-[11px] leading-relaxed text-zinc-300">
        {lines.map((line, i) => (
          <li key={i}>
            <span className="mr-1 text-sky-700 dark:text-sky-500">{i + 1}.</span>
            {line}
          </li>
        ))}
      </ol>
    </div>
  );
}

function segmentKey(analysis: QueryAnalysis): string {
  return analysisToSegments(analysis)
    .map((s) => `${s.kind}:${s.label}:${s.pages}`)
    .join("|");
}

/** Bad → good page-read meter for SQL tasks: the starting query vs yours. */
function BadGoodAnim({
  before,
  after,
}: {
  before: QueryAnalysis | undefined;
  after: QueryAnalysis;
}) {
  const renderMeter = (label: string, a: QueryAnalysis, tone: "bad" | "good") => (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
            tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {tone === "bad" ? "before · the query you started from" : label}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          {fmtNum(a.reads)} reads
          {a.writes > 0 ? ` + ${fmtNum(a.writes)} writes` : ""}
        </span>
      </div>
      <ReadsAnimation key={segmentKey(a)} segments={analysisToSegments(a)} title={label} />
    </div>
  );

  return (
    <div className="mt-3 space-y-2">
      {before ? renderMeter("before", before, "bad") : null}
      {renderMeter("after · your query", after, "good")}
      {before ? (
        <p className="font-mono text-[10px] text-zinc-500">
          {fmtNum(before.reads + before.writes)} → {fmtNum(after.reads + after.writes)} total page
          reads{after.reads + after.writes < before.reads + before.writes ? " · reads collapsed" : ""}
        </p>
      ) : null}
    </div>
  );
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function TaskRunner({ task, onPassed }: { task: LessonTask; onPassed: (grade: 1 | 2) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [solved, setSolved] = useState(false);

  const run = (input: unknown) => {
    const r = gradeTask(task, input);
    setAttempt((a) => a + 1);
    setResult(r);
    if (r.passed && !solved) {
      setSolved(true);
      onPassed(attempt === 0 ? 2 : 1);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4">
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        Try it out{attempt > 0 ? ` · attempt ${attempt}` : ""}
      </h4>
      <p className="mb-3 text-sm text-zinc-200">{task.prompt}</p>

      {task.kind === "number" ? <NumberInputTask onCheck={(v) => run(v)} /> : null}
      {task.kind === "plan-choice" ? (
        <ChoiceTask
          options={task.options}
          selected={selected}
          onPick={(id) => {
            setSelected(id);
            run(id);
          }}
        />
      ) : null}
      {task.kind === "btree" ? (
        <button
          onClick={() => run(null)}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Verify tree shape
        </button>
      ) : null}
      {task.kind === "isolation" ? <IsolationPick onRun={(l) => run(l)} /> : null}
      {task.kind === "buffer" ? <BufferPick onRun={(f, p) => run({ frames: f, policy: p })} /> : null}
      {task.kind === "sql" ? <SqlTaskEditor task={task} onRun={(sql) => run(sql)} /> : null}

      {sqlDataOf(result) ? (
        <BadGoodAnim before={sqlDataOf(result)!.before} after={sqlDataOf(result)!.analysis!} />
      ) : null}

      {analysisOf(result) ? (
        <div className="mt-3">
          <QueryAnalysisPanel analysis={analysisOf(result)!} />
        </div>
      ) : null}

      {result ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            result.passed
              ? "border-emerald-300 dark:border-emerald-800 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-amber-200 dark:border-amber-900 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}
        >
          {result.passed ? "✓ " : "× "}
          {result.detail}
        </div>
      ) : null}

      {task.kind === "number" && task.work && result ? (
        <WorkedCalc lines={task.work} />
      ) : null}
    </div>
  );
}

function IsolationPick({ onRun }: { onRun: (level: IsolationLevel) => void }) {
  const [level, setLevel] = useState<IsolationLevel | "">("");
  return (
    <label className="flex items-center gap-2">
      <select
        value={level}
        onChange={(e) => setLevel(e.target.value as IsolationLevel)}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-600"
      >
        <option value="">Select isolation level…</option>
        {ISOLATIONS.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </select>
      <button
        disabled={!level}
        onClick={() => level && onRun(level)}
        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
      >
        Run simulation
      </button>
    </label>
  );
}

function BufferPick({
  onRun,
}: {
  onRun: (frames: number, policy: EvictionPolicy) => void;
}) {
  const [frames, setFrames] = useState(4);
  const [policy, setPolicy] = useState<EvictionPolicy>("lru");
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Frames</span>
        <input
          type="range"
          min={4}
          max={16}
          value={frames}
          onChange={(e) => setFrames(Number(e.target.value))}
          className="w-32 accent-emerald-500"
        />
        <span className="w-6 font-mono text-zinc-200">{frames}</span>
      </label>
      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        {(["lru", "clock"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPolicy(p)}
            className={`rounded-md px-3 py-1 font-mono text-xs ${
              policy === p ? "bg-zinc-800 text-emerald-700 dark:text-emerald-300" : "text-zinc-500"
            }`}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        onClick={() => onRun(frames, policy)}
        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        Simulate
      </button>
    </div>
  );
}

function SqlTaskEditor({
  task,
  onRun,
}: {
  task: SqlTask;
  onRun: (sql: string) => void;
}) {
  const [sql, setSql] = useState(task.vs ?? "");
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="space-y-3">
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun(sql);
        }}
        spellCheck={false}
        rows={6}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm leading-relaxed text-zinc-100 outline-none focus:border-emerald-600"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onRun(sql)}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
        >
          Run & analyze
        </button>
        {task.hint ? (
          <button
            onClick={() => setShowHint((h) => !h)}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            {showHint ? "Hide hint" : "Hint"}
          </button>
        ) : null}
      </div>
      {showHint && task.hint ? (
        <p className="text-xs text-amber-700/90 dark:text-amber-300/90">{task.hint}</p>
      ) : null}
    </div>
  );
}

/** Extract the QueryAnalysis a sql task attached to its result (if any). */
function analysisOf(result: TaskResult | null): QueryAnalysis | null {
  if (!result?.data || typeof result.data !== "object") return null;
  const d = result.data as { analysis?: QueryAnalysis };
  return d.analysis ?? null;
}

/** Extract the before/after analyses a sql task attached (if any). */
function sqlDataOf(
  result: TaskResult | null,
): { before?: QueryAnalysis; analysis?: QueryAnalysis } | null {
  if (!result?.data || typeof result.data !== "object") return null;
  const d = result.data as { before?: QueryAnalysis; analysis?: QueryAnalysis };
  return d.analysis ? { before: d.before, analysis: d.analysis } : null;
}

/** True when the lesson is complete: capstone solved, or its task passed. */
export function lessonComplete(progress: ReturnType<typeof useProgress>, lessonId: string): boolean {
  const loc = lessonFor(lessonId);
  if (!loc) return false;
  const capstone = loc.lesson.blocks.find(
    (b): b is Extract<LessonBlock, { kind: "capstone" }> => b.kind === "capstone",
  );
  return capstone
    ? Boolean(progress.challenges[capstone.challengeId])
    : lessonCompleted(progress, lessonId);
}

function CourseSidebar({
  currentId,
  onJump,
}: {
  currentId: string;
  onJump: (id: string) => void;
}) {
  const progress = useProgress();
  const lessonOrder = new Map(COURSE_LESSONS.map((c, i) => [c.lesson.id, i + 1]));
  return (
    <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900/30 md:block">
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Course · {COURSE_LESSONS.length} lessons
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-emerald-500"
            style={{
              width: `${Math.round((COURSE_LESSONS.filter((c) => lessonComplete(progress, c.lesson.id)).length / COURSE_LESSONS.length) * 100)}%`,
            }}
          />
        </div>
      </div>
      {UNITS.map((unit) => (
        <div key={unit.id}>
          <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            {unit.title.replace(/^Unit \d · /, "")}
          </div>
          <ul>
            {unit.lessons.map((l) => {
              const num = lessonOrder.get(l.id) ?? 0;
              const done = lessonComplete(progress, l.id);
              const active = l.id === currentId;
              return (
                <li key={l.id}>
                  <button
                    onClick={() => onJump(l.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300"
                        : done
                          ? "text-zinc-400 hover:bg-zinc-800/60"
                          : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
                    }`}
                  >
                    <span
                      className={`shrink-0 font-mono text-[9px] ${done ? "text-emerald-700 dark:text-emerald-500" : "text-zinc-600"}`}
                    >
                      {done ? "✓" : String(num).padStart(2, "0")}
                    </span>
                    <span className="truncate">{l.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}

export default function LessonView({ lessonId }: { lessonId: string }) {
  const loc = useMemo(() => lessonFor(lessonId), [lessonId]);
  const progress = useProgress();
  const router = useRouter();
  const [justCompleted, setJustCompleted] = useState(false);

  if (!loc) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-zinc-500">
        Unknown lesson.
      </div>
    );
  }
  const { unit, lesson } = loc;

  const capstone = lesson.blocks.find(
    (b): b is Extract<LessonBlock, { kind: "capstone" }> => b.kind === "capstone",
  );
  const completed =
    capstone ? Boolean(progress.challenges[capstone.challengeId])
    : lessonCompleted(progress, lesson.id) || justCompleted;

  const courseIdx = COURSE_LESSONS.findIndex((c) => c.lesson.id === lesson.id);
  const nextLesson = COURSE_LESSONS[courseIdx + 1]?.lesson.id ?? null;
  const prevLesson = COURSE_LESSONS[courseIdx - 1]?.lesson.id ?? null;

  return (
    <div className="flex min-h-0 w-full flex-1 bg-zinc-950 text-zinc-200">
      <CourseSidebar currentId={lesson.id} onJump={(id) => router.push(`/learn/${id}`)} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => router.push("/learn")}
            className="rounded-lg border border-zinc-800 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            ← All lessons
          </button>
          <span className="font-mono text-[11px] text-zinc-600">
            Lesson {courseIdx + 1} of {COURSE_LESSONS.length}
          </span>
          <span className="ml-auto hidden items-center gap-2 sm:flex">
            <div className="h-1 w-28 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-emerald-500"
                style={{
                  width: `${Math.round((COURSE_LESSONS.filter((c) => lessonComplete(progress, c.lesson.id)).length / COURSE_LESSONS.length) * 100)}%`,
                }}
              />
            </div>
            <span className="text-[11px] text-zinc-500">
              {COURSE_LESSONS.filter((c) => lessonComplete(progress, c.lesson.id)).length}/
              {COURSE_LESSONS.length} complete
            </span>
          </span>
        </div>

        <p className="text-xs font-medium tracking-wide text-zinc-500">
          {unit.title}
          {capstone ? " · Production incident" : ""}
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100">{lesson.title}</h2>
        <p className="mt-2 text-sm text-zinc-400">{lesson.intro}</p>
        <p className="mt-1 font-mono text-[11px] text-zinc-600">{lesson.minutes} min read + task</p>

        <div key={lesson.id} className="mt-6 space-y-5">
          {lesson.blocks.map((block, bi) => {
            switch (block.kind) {
              case "prose":
                return (
                  <div key={bi} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4">
                    <Prose markdown={block.markdown} />
                  </div>
                );
              case "callout":
                return <Callout key={bi} title={block.title} body={block.body} />;
              case "task":
                return (
                  <TaskRunner
                    key={bi}
                    task={block.task}
                    onPassed={(grade) => {
                      recordLesson(lesson.id, { completedAt: Date.now(), grade });
                      setJustCompleted(true);
                    }}
                  />
                );
              case "capstone": {
                const solved = Boolean(progress.challenges[block.challengeId]);
                return (
                  <div
                    key={bi}
                    className="rounded-xl border border-amber-200/60 dark:border-amber-800/60 bg-amber-100 dark:bg-amber-950/20 px-4 py-4"
                  >
                    <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      Production incident
                    </h4>
                    <p className="mb-3 text-sm text-zinc-200">{block.note}</p>
                    <button
                      onClick={() => router.push(`/challenges/${block.challengeId}`)}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                    >
                      {solved ? "Re-open challenge" : `Open: ${challengeTitle(block.challengeId)}`}
                    </button>
                    {solved ? (
                      <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">✓ This capstone is complete.</p>
                    ) : null}
                  </div>
                );
              }
              default:
                return null;
            }
          })}
        </div>

        {completed ? (
          <div className="mt-6 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <span>Lesson complete.</span>
            {nextLesson ? (
              <button
                onClick={() => router.push(`/learn/${nextLesson}`)}
                className="ml-2 rounded-md bg-emerald-700 px-3 py-1 text-white hover:bg-emerald-600"
              >
                Next: {lessonName(nextLesson)}
              </button>
            ) : (
              <button
                onClick={() => router.push("/learn")}
                className="ml-2 rounded-md bg-emerald-700 px-3 py-1 text-white hover:bg-emerald-600"
              >
                Back to units
              </button>
            )}
            {prevLesson ? (
              <button
                onClick={() => router.push(`/learn/${prevLesson}`)}
                className="ml-2 rounded-md bg-zinc-800 px-3 py-1 text-zinc-200 hover:bg-zinc-700"
              >
                ← Previous
              </button>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

function titleCase(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function challengeTitle(id: string): string {
  return challengeFor(id)?.title ?? titleCase(id);
}

function lessonName(id: string): string {
  return lessonFor(id)?.lesson.title ?? id;
}