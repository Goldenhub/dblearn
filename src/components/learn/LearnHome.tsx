"use client";

/**
   * Learn course map — the default landing view. Lists the five units with their
   * lessons, live progress, and the badge wall. Capstone lessons are marked
   * complete once their challenge record exists in the store.
   */

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { COURSE_LESSONS, UNITS, type Unit } from "@/lib/lessons/curriculum";
import { challengeFor } from "@/lib/challenges/catalog";
import {
  badgesFor,
  lessonCount,
  lessonCompleted,
  totalStars,
  useProgress,
  type ProgressState,
} from "@/lib/store/useProgressStore";

function capstoneChallengeId(unit: Unit, lessonId: string): string | null {
  const lesson = unit.lessons.find((l) => l.id === lessonId);
  const cap = lesson?.blocks.find((b) => b.kind === "capstone");
  return cap?.kind === "capstone" ? cap.challengeId : null;
}

export function isLessonComplete(progress: ProgressState, unit: Unit, lessonId: string): boolean {
  const cap = capstoneChallengeId(unit, lessonId);
  return cap ? Boolean(progress.challenges[cap]) : lessonCompleted(progress, lessonId);
}

export default function LearnHome() {
  const progress = useProgress();
  const router = useRouter();
  const badges = useMemo(() => badgesFor(progress), [progress]);
  const learned = lessonCount(progress);
  const stars = totalStars(progress);
  const unlockedBadges = badges.filter((b) => b.unlockedAt !== null).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Learn database engineering</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Five units, each ending in a production incident. Tasks run in the browser — no setup.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm">
            <span className="font-mono text-zinc-300">
              {learned}/{COURSE_LESSONS.length} lessons
            </span>
            <span className="h-1 w-32 overflow-hidden rounded-full bg-zinc-800">
              <span
                className="block h-full bg-emerald-500 transition-all"
                style={{ width: `${(learned / COURSE_LESSONS.length) * 100}%` }}
              />
            </span>
            <span className="font-mono text-amber-600 dark:text-amber-400">{stars} ★</span>
          </div>
        </div>

        <div className="space-y-6">
          {UNITS.map((unit, ui) => {
            const done = unit.lessons.filter((l) => isLessonComplete(progress, unit, l.id)).length;
            return (
              <section key={unit.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/40">
                <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 font-mono text-xs font-bold text-zinc-300">
                    {ui + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-100">{unit.title}</h3>
                    <p className="truncate text-xs text-zinc-500">{unit.tagline}</p>
                  </div>
                  <span className="ml-auto font-mono text-[11px] text-zinc-500">
                    {done}/{unit.lessons.length}
                  </span>
                </header>
                <ul className="divide-y divide-zinc-800/60">
                  {unit.lessons.map((lesson, li) => {
                    const complete = isLessonComplete(progress, unit, lesson.id);
                    const cap = capstoneChallengeId(unit, lesson.id);
                    const capTitle = cap ? challengeFor(cap)?.title ?? cap : null;
                    return (
                      <li key={lesson.id}>
                        <button
                          onClick={() => router.push(`/learn/${lesson.id}`)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-800/40"
                        >
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                              complete
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-zinc-700 text-zinc-600"
                            }`}
                          >
                            {complete ? "✓" : li + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-zinc-200">
                              {lesson.title}
                              {cap ? (
                                <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 dark:text-amber-400">
                                  CAPSTONE
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-zinc-500">
                              {cap ? capTitle : lesson.intro}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                            {lesson.minutes} min
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">
            Badges{" "}
            <span className="font-mono text-[11px] font-normal text-zinc-500">
              {unlockedBadges}/{badges.length} unlocked
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span
                key={badge.id}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                  badge.unlockedAt !== null
                    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-600"
                }`}
                title={badge.label}
              >
                {badge.unlockedAt !== null ? "◆ " : "◇ "}
                {badge.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}