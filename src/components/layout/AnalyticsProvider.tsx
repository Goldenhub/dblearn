"use client";

import posthog from "posthog-js";
import { PostHogErrorBoundary, PostHogProvider } from "@posthog/react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { capturePageLeave, capturePageview, initAnalytics } from "@/lib/dblearnlytics";

if (typeof window !== "undefined") initAnalytics();

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return (
    <PostHogProvider client={posthog}>
      <PostHogErrorBoundary>
        <TrackPageview />
        {children}
      </PostHogErrorBoundary>
    </PostHogProvider>
  );
}

interface PageSession {
  url: string;
  startedAt: number;
}

/**
 * Manual `$pageview` on every route change plus a matching `$pageleave` for the
 * page being left. The pageleave fires *before* the new pageview so the SDK's
 * pageViewManager pairs them (`$pageview_id`/`$prev_pageview_id`); `duration_ms`
 * is our own dwell time. `pagehide` closes the final page (beacon transport);
 * `pageshow`/bfcache restore re-opens the session.
 */
function TrackPageview() {
  const pathname = usePathname();
  const session = useRef<PageSession | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    const previous = session.current;
    if (previous && !closed.current) {
      capturePageLeave(previous.url, Date.now() - previous.startedAt);
    }
    closed.current = false;
    capturePageview();
    session.current = { url: window.location.href, startedAt: Date.now() };
  }, [pathname]);

  useEffect(() => {
    const closeSession = () => {
      const current = session.current;
      if (!current || closed.current) return;
      closed.current = true;
      capturePageLeave(current.url, Date.now() - current.startedAt, true);
    };
    const reopenSession = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      closed.current = false;
      capturePageview();
      session.current = { url: window.location.href, startedAt: Date.now() };
    };
    window.addEventListener("pagehide", closeSession);
    window.addEventListener("pageshow", reopenSession);
    return () => {
      window.removeEventListener("pagehide", closeSession);
      window.removeEventListener("pageshow", reopenSession);
    };
  }, []);

  return null;
}
