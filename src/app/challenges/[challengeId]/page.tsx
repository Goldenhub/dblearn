import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ChallengeWorkspace from "@/components/challenge/ChallengeWorkspace";
import { CHALLENGES, challengeFor } from "@/lib/challenges/catalog";

export const dynamicParams = true;

export function generateStaticParams() {
  return CHALLENGES.map((challenge) => ({ challengeId: challenge.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}): Promise<Metadata> {
  const { challengeId } = await params;
  const challenge = challengeFor(challengeId);
  return {
    title: challenge ? `${challenge.title} · Challenges · dblearn` : "Challenge · dblearn",
    description: challenge?.story,
  };
}

export default async function Page({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  if (!challengeFor(challengeId)) notFound();
  return (
    <div className="lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <ChallengeWorkspace key={challengeId} initialChallengeId={challengeId} />
    </div>
  );
}