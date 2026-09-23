import type { Metadata } from "next";

import ChallengeWorkspace from "@/components/challenge/ChallengeWorkspace";

export const metadata: Metadata = {
  title: "Challenges · dblearn",
  description: "Five production database incidents — missing indexes, N+1 queries, dirty reads, buffer thrash, and deadlocks. Fix them to earn capstone badges.",
};

export default function Page() {
  return (
    <div className="lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <ChallengeWorkspace key="hub" />
    </div>
  );
}