import posthog from "posthog-js/dist/module.full";

/**
 * dblearn analytics (PostHog) — port of mongeesy's `phuglytics.js`.
 *
 * Same PostHog project as mongodb-easy (shared token), so every event carries
 * a literal `app: "dblearn"` property. In the PostHog dashboard filter or
 * break down by the `app` property to isolate dblearn traffic from mongeesy
 * traffic (mongeesy events arrive untagged unless that app adds its own tag).
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const APP_TAG = "dblearn";
const OFFLINE_QUEUE_KEY = "dblearn-analytics-queue";
const MAX_QUEUE = 500;

/** Disabled until a real project key is provided (must be `phc_…`). */
const ENABLED =
  typeof window !== "undefined" && KEY.length > 0 && KEY.startsWith("phc_");

let initialized = false;

export function initAnalytics(): void {
  if (!ENABLED || initialized) return;
  initialized = true;
  posthog.init(KEY, {
    api_host: `${window.location.origin}/tt`,
    capture_pageview: false,
    autocapture: false,
    // dblearn is a learning/reference tool; posthog's UA-based bot detection
    // silently drops captures from anything that sniffs like a bot/headless
    // browser. Disable that filter so events flow from every browser.
    opt_out_useragent_filter: true,
    persistence: "localStorage",
    disable_surveys: true,
  });
  window.addEventListener("online", flushOfflineQueue);
  if (navigator.onLine) flushOfflineQueue();
}

type Properties = Record<string, unknown>;

function capture(event: string, properties: Properties = {}): void {
  if (!navigator.onLine) {
    queueOffline(event, properties);
    return;
  }
  posthog.capture(event, { app: APP_TAG, ...properties });
}

function queueOffline(event: string, properties: Properties): void {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]") as Array<{
      event: string;
      properties: Properties;
      ts: number;
    }>;
    queue.push({ event, properties, ts: Date.now() });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* queue full or unavailable */
  }
}

function flushOfflineQueue(): void {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return;
    const queue = JSON.parse(raw) as Array<{ event: string; properties: Properties }>;
    if (queue.length === 0) return;
    for (const item of queue) {
      posthog.capture(item.event, { app: APP_TAG, ...item.properties });
    }
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch {
    /* failed to flush */
  }
}

export function capturePageview(): void {
  if (!ENABLED) return;
  capture("$pageview");
}

/**
 * Fire a `$pageleave` for the page being left. The SDK only emits pageleave on
 * `pagehide` (tab close/hide) and only when its own `capture_pageview` is
 * enabled — which ours is not (we capture pageviews manually to keep the `app`
 * tag). So we emit per-route pageleaves ourselves, *before* the next route's
 * `$pageview`, which lets the SDK's pageViewManager attach the matching
 * `$pageview_id`/`$prev_pageview_id`. `previousUrl` is the URL of the page
 * being left (the browser location has already moved on by the time this runs);
 * `durationMs` is our own dwell time since that page's `$pageview` (the SDK's
 * `$duration` is dead in this build).
 */
export function capturePageLeave(previousUrl: string, durationMs: number, immediate = false): void {
  if (!ENABLED) return;
  const properties = { $current_url: previousUrl, duration_ms: Math.max(0, Math.round(durationMs)) };
  if (immediate && navigator.onLine) {
    // The document is unloading — bypass the batch queue and send via beacon.
    posthog.capture("$pageleave", { app: APP_TAG, ...properties }, { transport: "sendBeacon", send_instantly: true });
    return;
  }
  capture("$pageleave", properties);
}

export function ctaClicked(label: string, location: string): void {
  if (!ENABLED) return;
  capture("cta_clicked", { cta_label: label, cta_location: location });
}

export function labOpened(lab: string): void {
  if (!ENABLED) return;
  capture("lab_opened", { lab });
}

export function lessonStarted(lessonId: string, lessonTitle: string, lessonUnit: string): void {
  if (!ENABLED) return;
  capture("lesson_started", { lesson_id: lessonId, lesson_title: lessonTitle, lesson_unit: lessonUnit });
}

export function lessonCompleted(lessonId: string, grade: 1 | 2, attempts: number): void {
  if (!ENABLED) return;
  capture("lesson_completed", { lesson_id: lessonId, grade, total_attempts: attempts });
}

export function unitCompleted(unitId: string, unitTitle: string, lessonId: string): void {
  if (!ENABLED) return;
  capture("unit_completed", { unit_id: unitId, unit_title: unitTitle, lesson_id: lessonId });
}

export function courseCompleted(completedCount: number): void {
  if (!ENABLED) return;
  capture("course_completed", { completed_count: completedCount });
}

export function queryRun(target: string, wallMs?: number): void {
  if (!ENABLED) return;
  capture("query_run", { target, wall_ms: wallMs ?? null });
}

export function queryError(target: string, message: string): void {
  if (!ENABLED) return;
  capture("query_error", { target, error_message: message });
}

export function challengeStarted(challengeId: string, challengeTitle: string): void {
  if (!ENABLED) return;
  capture("challenge_started", { challenge_id: challengeId, challenge_title: challengeTitle });
}

export function challengeAttempt(challengeId: string, passed: boolean, attempts: number): void {
  if (!ENABLED) return;
  capture("challenge_attempt", { challenge_id: challengeId, passed, total_attempts: attempts });
}

export function challengeCompleted(challengeId: string, stars: number, efficiency: number): void {
  if (!ENABLED) return;
  capture("challenge_completed", { challenge_id: challengeId, stars, efficiency });
}

export function hintRevealed(challengeId: string, hintsUsed: number): void {
  if (!ENABLED) return;
  capture("hint_revealed", { challenge_id: challengeId, hints_used: hintsUsed });
}

export function scenarioRun(scenarioId: string): void {
  if (!ENABLED) return;
  capture("scenario_run", { scenario_id: scenarioId });
}

export function captureException(error: unknown): void {
  if (!ENABLED) return;
  const message = error instanceof Error ? error.message : String(error);
  if (!navigator.onLine) {
    queueOffline("$exception", { error: message });
    return;
  }
  posthog.captureException(error instanceof Error ? error : new Error(message), { app: APP_TAG });
}