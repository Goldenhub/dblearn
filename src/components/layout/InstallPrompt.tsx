"use client";

import { useSyncExternalStore, useState } from "react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "dblearn.installDismissed";

type InstallSnapshot = { bip: BIPEvent | null; installed: boolean; ios: boolean };

function isIOSBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

let deferredEvent: BIPEvent | null = null;
let installedFlag = false;
let snapshot: InstallSnapshot = { bip: null, installed: false, ios: false };

function computeSnapshot(): InstallSnapshot {
  const next: InstallSnapshot = {
    bip: deferredEvent,
    installed: installedFlag || isStandalone(),
    ios: isIOSBrowser() && !isStandalone(),
  };
  if (next.bip !== snapshot.bip || next.installed !== snapshot.installed || next.ios !== snapshot.ios) {
    snapshot = next;
  }
  return snapshot;
}

function subscribe(callback: () => void): () => void {
  const onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    deferredEvent = e as BIPEvent;
    callback();
  };
  const onAppInstalled = () => {
    installedFlag = true;
    callback();
  };
  const onDisplayModeChange = () => callback();
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onDisplayModeChange);
  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
    mq.removeEventListener("change", onDisplayModeChange);
  };
}

const SERVER_INSTALL_SNAPSHOT: InstallSnapshot = { bip: null, installed: false, ios: false };
const getServerSnapshot = (): InstallSnapshot => SERVER_INSTALL_SNAPSHOT;

export default function InstallPrompt() {
  const { bip: deferred, installed, ios } = useSyncExternalStore(subscribe, computeSnapshot, getServerSnapshot);
  const [iosOpen, setIosOpen] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "1",
  );

  const show = !installed && !dismissed && (deferred !== null || ios);
  if (!show) return null;

  const handleInstall = () => {
    if (deferred) {
      setIosOpen(false);
      void deferred.prompt().then(() =>
        deferred.userChoice.then((choice) => {
          if (choice.outcome === "accepted") {
            window.dispatchEvent(new Event("appinstalled"));
          }
        }),
      );
    } else if (ios) {
      setIosOpen((o) => !o);
    }
  };

  const disableIos = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="relative">
      <button
        onClick={handleInstall}
        aria-label="Install app"
        title="Install app"
        aria-expanded={iosOpen}
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M4 19h16" />
        </svg>
      </button>

      {iosOpen && ios ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-zinc-100">Install on iOS</div>
            <button
              onClick={disableIos}
              aria-label="Dismiss install prompt"
              className="text-zinc-500 hover:text-zinc-300"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <ol className="space-y-2 text-[11px] leading-5 text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">1</span>
              <span>
                Tap <span className="text-zinc-200">Share</span>{" "}
                <svg className="inline" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V9" />
                  <path d="M7 13l5-5 5 5" />
                  <path d="M3 19h18" />
                </svg>{" "}
                in the Safari toolbar.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">2</span>
              <span>
                Tap <span className="text-zinc-200">Add to Home Screen</span>, then <span className="text-zinc-200">Add</span>.
              </span>
            </li>
          </ol>
          <p className="mt-2 text-[10px] text-zinc-500">The app runs fully offline once added.</p>
        </div>
      ) : null}
    </div>
  );
}