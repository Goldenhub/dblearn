import type { Metadata } from "next";

import ConcurrencyPlayground from "@/components/concurrency/ConcurrencyPlayground";

export const metadata: Metadata = {
  title: "Isolation · dblearn",
  description: "Run concurrent transactions across isolation levels and watch dirty reads, non-repeatable reads, phantoms, and deadlocks in a live timeline.",
};

export default function Page() {
  return (
    <div className="min-h-0 flex-1">
      <ConcurrencyPlayground />
    </div>
  );
}