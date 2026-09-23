"use client";

import { useState } from "react";

import { useTheme } from "@/lib/theme";
import Link from "next/link";
import { usePathname } from "next/navigation";
import InstallPrompt from "@/components/layout/InstallPrompt";

const TABS = [
  { href: "/learn", label: "Learn" },
  { href: "/plan", label: "Query Plan" },
  { href: "/btree", label: "B-Tree Index" },
  { href: "/isolation", label: "Isolation" },
  { href: "/challenges", label: "Challenges" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppHeader() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-50 flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-3 sm:gap-4 sm:px-4">
      <Link href="/" className="font-mono text-sm font-bold tracking-tight text-zinc-100">
        dblearn
      </Link>
      <span className="hidden text-xs text-zinc-500 md:inline">database engine playground</span>

      <nav className="ml-auto hidden items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 md:flex">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive(pathname, tab.href) ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              isActive(pathname, tab.href)
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* hamburger toggles a stacked nav on small screens */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
      >
        {/* both icons stay in the DOM (visibility via CSS) so hydration never differs */}
        <svg
          className={open ? "hidden" : "block"}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        <svg
          className={open ? "block" : "hidden"}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <button
        onClick={toggle}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        title="Toggle theme"
        suppressHydrationWarning
        className="flex h-8 w-8 items-center justify-center rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      >
        {/* both icons are always in the DOM (visibility toggled by CSS class)
            so the server and client SVG structure never differs, which would
            otherwise throw a React hydration mismatch on reload with a
            persisted theme */}
        <svg
          className={`${theme === "dark" ? "hidden" : "block"}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <svg
          className={`${theme === "dark" ? "block" : "hidden"}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>

      <InstallPrompt />

      {open ? (
        <div className="absolute inset-x-0 top-full z-50 border-b border-zinc-800 bg-zinc-950 p-2 md:hidden">
          <nav className="grid gap-1" aria-label="Mobile navigation">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(pathname, tab.href) ? "page" : undefined}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(pathname, tab.href)
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  );
}