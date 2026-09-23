import type { Metadata } from "next";

import BTreePlayground from "@/components/btree/BTreePlayground";

export const metadata: Metadata = {
  title: "B-Tree Index · dblearn",
  description: "Insert, delete, and look up keys in a live B-Tree. Watch node splits, pointer hops, and the O(log N) vs O(N) proof in your browser.",
};

export default function Page() {
  return (
    <div className="lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <BTreePlayground />
    </div>
  );
}