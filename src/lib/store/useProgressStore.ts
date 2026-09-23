"use client";

/**
 * Phase 6 — progress & accomplishment store.
 *
 * Self-contained client-side persistence (localStorage) with a
 * `useSyncExternalStore` interface — no extra dependency. Records per-challenge
 * completion (stars, efficiency score, attempts + hint penalties) and a small
 * set of unlockable badge milestones.
 */

import { useSyncExternalStore } from "react";

import { COURSE_LESSONS } from "../lessons/curriculum";

export interface ChallengeRecord {
  completedAt: number;
  stars: 1 | 2 | 3;
  efficiency: number;
  score: number;
  attempts: number;
  hintsUsed: number;
}

/** One finished lesson in the Learn course. */
export interface LessonRecord {
  completedAt: number;
  /** 1 = passed with help, 2 = passed clean on the first go. */
  grade: 1 | 2;
}

export type BadgeId =
  | "first_blood"
  | "indexer"
  | "joiner"
  | "pool_master"
  | "consistency"
  | "completionist"
  | "student"
  | "scholar"
  | "storage_ready"
  | "index_savvy"
  | "execution_ready"
  | "transaction_ready";

export interface BadgeState {
  id: BadgeId;
  label: string;
  unlockedAt: number | null;
}

export interface ProgressState {
  challenges: Record<string, ChallengeRecord>;
  lessons: Record<string, LessonRecord>;
  badgesUnlockedAt: Record<string, number>;
}

const INITIAL: ProgressState = { challenges: {}, lessons: {}, badgesUnlockedAt: {} };

const STORAGE_KEY = "dblearn.progress.v1";

function readStorage(): ProgressState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as Partial<ProgressState>;
    return {
      challenges: parsed.challenges ?? {},
      lessons: parsed.lessons ?? {},
      badgesUnlockedAt: parsed.badgesUnlockedAt ?? {},
    };
  } catch {
    return INITIAL;
  }
}

let state: ProgressState = readStorage();
const listeners = new Set<() => void>();

function persist(next: ProgressState) {
  state = next;
  for (const l of listeners) l();
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / private mode — keep in-memory state */
  }
}

export function getProgress(): ProgressState {
  return state;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function recordChallenge(id: string, rec: ChallengeRecord) {
  const prev = state.challenges[id];
  if (prev && prev.score >= rec.score && prev.completedAt <= rec.completedAt) return;
  const challenges = { ...state.challenges, [id]: rec };
  const lessons = state.lessons;
  const badgesUnlockedAt = computeBadgeTimes(challenges, lessons);
  persist({ challenges, lessons, badgesUnlockedAt });
}

/** Mark a lesson complete in the course. Passing on a later attempt keeps the best grade. */
export function recordLesson(id: string, rec: LessonRecord) {
  const prev = state.lessons[id];
  const lessons = {
    ...state.lessons,
    [id]: prev && prev.grade <= rec.grade ? prev : rec,
  };
  const badgesUnlockedAt = computeBadgeTimes(state.challenges, lessons);
  persist({ challenges: state.challenges, lessons, badgesUnlockedAt });
}

function theRec(s: ProgressState, id: string): ChallengeRecord | undefined {
  return s.challenges[id];
}

function computeBadgeTimes(
  challenges: Record<string, ChallengeRecord>,
  lessons: Record<string, LessonRecord>,
): Record<string, number> {
  const times: Record<string, number> = {};
  const rec = (id: string) => challenges[id];
  const unlocked = (id: string, ok: boolean, at?: number) => {
    if (ok) times[id] = at ?? Date.now();
  };
  const anyComplete = Object.values(challenges)[0]?.completedAt ?? null;
  if (anyComplete !== null) times.first_blood = anyComplete;
  unlocked("indexer", rec("missing_index")?.stars === 3);
  unlocked("joiner", Boolean(rec("n_plus_one")));
  unlocked("pool_master", Boolean(rec("buffer_thrash")));
  unlocked("consistency", Boolean(rec("deadlock_resolution")));
  if (Object.keys(challenges).length >= 5) {
    times.completionist = Math.max(...Object.values(challenges).map((c) => c.completedAt));
  }
  // Lesson/badge milestones.
  const lessonIds = Object.keys(lessons);
  const firstLessonAt = lessonIds.length ? Math.min(...lessonIds.map((id) => lessons[id].completedAt)) : null;
  unlocked("student", firstLessonAt !== null, firstLessonAt ?? undefined);
  const firstBatchAt = firstBatchLessonAt(lessons);
  if (firstBatchAt !== null) times.storage_ready = firstBatchAt;
  const indexerLessonAt = lessonAt(lessons, "btree-vs-scan");
  if (indexerLessonAt !== null) {
    times.index_savvy = indexerLessonAt;
    times.scholar = indexerLessonAt;
  }
  const executionAt = lessonAt(lessons, "capstone-nplusone");
  if (executionAt !== null) times.execution_ready = executionAt;
  const txnAt = lessonAt(lessons, "capstone-deadlock");
  if (txnAt !== null) times.transaction_ready = txnAt;
  return times;
}

/**
 * Lesson → unit map derived from the single source of truth (curriculum order).
 * Derived so adding lessons to the course can never desync progress grouping.
 */
const unitOfLesson: Record<string, string> = Object.fromEntries(
  COURSE_LESSONS.map((c) => [c.lesson.id, c.unit.id]),
);

function lessonAt(lessons: Record<string, LessonRecord>, id: string): number | null {
  return lessons[id]?.completedAt ?? null;
}

/** A storage unit counts as done once its capstone completes. */
function firstBatchLessonAt(lessons: Record<string, LessonRecord>): number | null {
  const at = lessonAt(lessons, "capstone-buffer");
  return at;
}

const BADGE_META: { id: BadgeId; label: string }[] = [
  { id: "first_blood", label: "First Commit — solve any challenge" },
  { id: "indexer", label: "Index Seer — perfect The Missing Index (★★★)" },
  { id: "joiner", label: "N+1 Slayer — solve The N+1 Query Disaster" },
  { id: "pool_master", label: "Pool Master — finish The Buffer Pool Thrash" },
  { id: "consistency", label: "Lock Keeper — resolve the deadlock" },
  { id: "completionist", label: "Production DBA — complete all five challenges" },
  { id: "student", label: "Classroom — finish your first lesson" },
  { id: "scholar", label: "Scholar — prove a B-Tree beats a scan" },
  { id: "storage_ready", label: "Storage Ready — pass the Buffer Pool Thrash capstone" },
  { id: "index_savvy", label: "Index Savvy — finish the B-Tree vs scan lesson" },
  { id: "execution_ready", label: "Execution Ready — pass the N+1 capstone" },
  { id: "transaction_ready", label: "Transaction Ready — resolve the deadlock capstone" },
];

export function badgesFor(s: ProgressState): BadgeState[] {
  return BADGE_META.map((m) => ({
    id: m.id,
    label: m.label,
    unlockedAt: s.badgesUnlockedAt[m.id] ?? null,
  }));
}

export function useProgress(): ProgressState {
  // Server snapshot = empty: during hydration the client matches the SSR HTML
  // (which had no localStorage), then re-renders once the real state is known.
  // Passing getProgress here would leak persisted values into the hydration
  // render and can throw React hydration errors on reload with saved progress.
  return useSyncExternalStore(subscribe, getProgress, () => INITIAL);
}

export function totalStars(s: ProgressState): number {
  return Object.values(s.challenges).reduce((n, r) => n + r.stars, 0);
}

export function completedCount(s: ProgressState): number {
  return Object.keys(s.challenges).length;
}

export function lessonCompleted(s: ProgressState, lessonId: string): boolean {
  return Boolean(s.lessons[lessonId]);
}

export function lessonCount(s: ProgressState): number {
  return Object.keys(s.lessons).length;
}

export function lessonsForUnit(s: ProgressState, unitId: string): string[] {
  return Object.keys(s.lessons).filter((id) => unitOfLesson[id] === unitId);
}

export { theRec as challengeRecord };
export { unitOfLesson };