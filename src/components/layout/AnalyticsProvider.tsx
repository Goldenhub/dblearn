"use client";

import posthog from "posthog-js";
import { PostHogErrorBoundary, PostHogProvider } from "@posthog/react";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { capturePageview, initAnalytics } from "@/lib/dblearnlytics";

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

function TrackPageview() {
  const pathname = usePathname();
  useEffect(() => {
    capturePageview();
  }, [pathname]);
  return null;
}