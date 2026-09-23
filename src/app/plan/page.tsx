import type { Metadata } from "next";

import PlanLab from "@/components/plan/PlanLab";

export const metadata: Metadata = {
  title: "Query Plan · dblearn",
  description: "Write SQL and watch DuckDB-Wasm build a live execution plan — operator nodes, costs, and timing, entirely in your browser.",
};

export default function Page() {
  return <PlanLab />;
}