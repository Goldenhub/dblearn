import type { Metadata } from "next";
import Link from "next/link";
import { UNITS } from "@/lib/lessons/curriculum";

export const metadata: Metadata = {
  title: "dblearn — database engine playground",
  description:
    "Learn database internals visually: SQL, query plans, B-Trees, buffer pools, and isolation levels — entirely in your browser. No backend, no setup.",
};

const MODULES = [
  {
    href: "/plan",
    tag: "planner",
    accent: "text-sky-700 dark:text-sky-400",
    dot: "bg-sky-400",
    title: "Query Plan Lab",
    blurb:
      "Type SQL and read a real EXPLAIN (ANALYZE, FORMAT JSON) plan from DuckDB-Wasm — graph nodes, cost heatmaps, and per-operator timing rendered live in your browser.",
  },
  {
    href: "/btree",
    tag: "indexes",
    accent: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-400",
    title: "B-Tree Index",
    blurb:
      "Insert, delete, and search keys to watch pages split, roots rise, and O(log N) pointer hops beat a full sequential scan — step by step, at your own speed.",
  },
  {
    href: "/isolation",
    tag: "transactions",
    accent: "text-rose-700 dark:text-rose-400",
    dot: "bg-rose-400",
    title: "Isolation Lab",
    blurb:
      "Run concurrent transactions across four isolation levels and watch dirty reads, non-repeatable reads, phantoms, and deadlocks appear — or disappear.",
  },
  {
    href: "/challenges",
    tag: "incidents",
    accent: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-400",
    title: "Challenge Incidents",
    blurb:
      "Five broken-production scenarios disguised as capstones: a missing index, an N+1 disaster, a buffer-pool thrash, a dirty read, and a deadlock. Fix each one to pass.",
  },
] as const;

export default function Home() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          100% in-browser · no backend · no setup
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
          Learn database internals by poking at one.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-zinc-400">
          dblearn is a course where you don&apos;t just read about query plans, B-Trees, buffer pools,
          and isolation levels — you run them. Every lesson pairs a first-principles explanation with
          a live visualizer you can break and fix.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/learn"
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            Start lesson one
          </Link>
          <a
            href="#how-it-works"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-50"
          >
            How it works
          </a>
        </div>

        <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 text-center sm:grid-cols-4">
          {[
            ["60", "lessons"],
            ["5", "capstone incidents"],
            ["4", "interactive labs"],
            ["0", "servers to run"],
          ].map(([n, label]) => (
            <div key={label} className="bg-zinc-950 px-4 py-6">
              <dt className="order-2 mt-1 text-xs text-zinc-500">{label}</dt>
              <dd className="order-1 text-3xl font-bold text-zinc-50">{n}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-16 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Modules
        </h2>
        <div className="mt-4 grid gap-4">
          {MODULES.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="group flex items-start gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
            >
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${m.dot}`} />
              <span>
                <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  {m.tag}
                </span>
                <span className="block font-semibold text-zinc-50">
                  {m.title} <span className={m.accent}>→</span>
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-zinc-400">
                  {m.blurb}
                </span>
              </span>
            </Link>
          ))}
        </div>

        <section id="how-it-works" className="mt-16">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            How it works
          </h2>
          <ol className="mt-4 space-y-4">
            {[
              ["Read", "Each of the 60 lessons opens with a short, first-principles explanation — pages, I/O latency, B-Tree splits, lock queues."],
              ["Tinker", "Right in the lesson, try the task: answer a question, size a query, or drag through a live simulation."],
              ["Prove it", "Fix the five capstone incidents — the missing index, the N+1, the thrash, the dirty read, the deadlock — and watch real metrics before and after."],
            ].map(([step, desc], i) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-zinc-400">
                  <span className="font-semibold text-zinc-50">{step}.</span>{" "}
                  {desc}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-14 text-sm font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          Course track
        </p>
        <ul className="mt-3 space-y-2">
          {UNITS.map((u) => (
            <li key={u.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="font-mono text-xs text-zinc-500 sm:w-56 sm:shrink-0">{u.title}</span>
              <span className="text-sm text-zinc-400 sm:min-w-0 sm:truncate">{u.tagline}</span>
            </li>
          ))}
        </ul>

        <div className="mt-14 rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-700/50 dark:bg-emerald-950/40">
          <p className="text-xl font-semibold text-zinc-50">
            The fastest way to learn a database is to drive one.
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            No installs, no credits, no servers. Just you and an engine in a browser tab.
          </p>
          <Link
            href="/learn"
            className="mt-5 inline-block rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            Begin the course
          </Link>
        </div>

        <p className="mt-10 text-center font-mono text-xs text-zinc-500">
          dblearn · everything runs in your browser, even the database
        </p>
        <div className="mt-6 flex flex-col items-center gap-4">
          <a
            href="https://github.com/goldenhub/dblearn"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
          >
            <span className="text-amber-400" aria-hidden="true">
              ★
            </span>
            Star dblearn on GitHub
          </a>
          <p className="text-center text-xs text-zinc-500">
            Built by{" "}
            <a
              href="https://github.com/goldenhub"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-50"
            >
              Goldenhub
            </a>
            {" "}·{" "}
            <a
              href="https://x.com/gazu_chi"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-50"
            >
              X
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}