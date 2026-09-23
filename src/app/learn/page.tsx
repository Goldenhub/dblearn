import type { Metadata } from "next";

import LearnHome from "@/components/learn/LearnHome";

export const metadata: Metadata = {
  title: "Learn · dblearn",
  description: "A structured, 60-lesson beginner track through database engineering: memory vs disk, storage, indexes, query execution, and transactions.",
};

export default function Page() {
  return <LearnHome />;
}