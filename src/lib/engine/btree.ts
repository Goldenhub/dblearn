/**
 * Phase 3 — B-Tree engine with step recording for visual playback.
 *
 * Conventions (CLRS "minimum degree" t): every page holds between t-1 and
 * 2t-1 keys; the split/overflow threshold is exactly the `2t - 1` cap from
 * the spec. Order (max children) = 2t. This is the only formulation where
 * delete-merges are provably exact (min + min + 1 pivot = 2t - 1), so the
 * engine can never produce an overfull page.
 */

export type BTreeDegree = 2 | 3;

export interface BTreeConfig {
  /** CLRS minimum degree — page holds t-1 .. 2t-1 keys. */
  t: BTreeDegree;
  /** Max children a page may have (== 2t). */
  order: number;
  /** Max keys per page (== 2t - 1). */
  maxKeys: number;
  /** Min keys for a non-root page (== t - 1). */
  minKeys: number;
}

export interface BTreeNodeData {
  id: string;
  keys: number[];
  childIds: string[];
  leaf: boolean;
}

export interface BTreeSnapshot {
  config: BTreeConfig;
  rootId: string;
  nodes: BTreeNodeData[];
  totalKeys: number;
  height: number;
}

export type StepKind =
  | "start"
  | "compare"
  | "descend"
  | "match"
  | "successor"
  | "remove"
  | "insert"
  | "overflow"
  | "split"
  | "promote"
  | "root-up"
  | "borrow"
  | "merge"
  | "root-down"
  | "found"
  | "not-found"
  | "duplicate";

export interface BTreeStepActive {
  nodeId: string;
  /** Index of the key chip to highlight inside the page. */
  keyIndex?: number;
}

export interface BTreeStep {
  id: number;
  kind: StepKind;
  label: string;
  snapshot: BTreeSnapshot;
  /** Node ids visited along the current pointer path (for hop highlighting). */
  pathIds: string[];
  active: BTreeStepActive | null;
}

export interface SearchResult {
  found: boolean;
  key: number;
  /** Node pages visited during the B-Tree lookup. */
  hops: number;
  /** Sequential-scan step count (worst case = every key read). */
  seqSteps: number;
}

export interface MutationResult {
  applied: boolean;
  key: number;
  steps: BTreeStep[];
}

interface MutableNode {
  id: string;
  keys: number[];
  children: MutableNode[];
  parent: MutableNode | null;
  leaf: boolean;
}



/** Sorted insertion point: first index with keys[idx] >= value. */
function lowerBound(keys: number[], value: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function leftmost(node: MutableNode): MutableNode {
  while (!node.leaf) node = node.children[0];
  return node;
}

function rightmost(node: MutableNode): MutableNode {
  while (!node.leaf) node = node.children[node.children.length - 1];
  return node;
}

export class BTree {
  private root: MutableNode;
  private readonly config: BTreeConfig;
  /**
   * Node ids are a per-instance counter so SSR and client hydration assign
   * identical ids for the same freshly-built tree. A module-global counter
   * diverged: the SSR realm and the browser realm each allocate different
   * numbers of ids before the playground's first tree, so the root came out
   * `n2` server-side but `n0` in the browser → React #418 on every /btree
   * load (only surfaced in dev; roots then retained stale module state).
   */
  private nextNodeId = 0;

  constructor(t: BTreeDegree) {
    this.config = {
      t,
      order: 2 * t,
      maxKeys: 2 * t - 1,
      minKeys: t - 1,
    };
    this.root = BTree.freshLeaf(this.newId());
  }

  private newId(): string {
    return `n${this.nextNodeId++}`;
  }

  get degree(): BTreeDegree {
    return this.config.t;
  }

  get configSnapshot(): BTreeConfig {
    return { ...this.config };
  }

  private static freshLeaf(id: string): MutableNode {
    return { id, keys: [], children: [], parent: null, leaf: true };
  }

  /** Full structural snapshot used by the renderer and recorded per step. */
  snapshot(): BTreeSnapshot {
    let totalKeys = 0;
    let height = 0;
    const nodes: BTreeNodeData[] = [];
    const visit = (node: MutableNode, depth: number): void => {
      height = Math.max(height, depth);
      totalKeys += node.keys.length;
      nodes.push({
        id: node.id,
        keys: [...node.keys],
        childIds: node.children.map((c) => c.id),
        leaf: node.leaf,
      });
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(this.root, 0);
    return {
      config: this.configSnapshot,
      rootId: this.root.id,
      nodes,
      totalKeys,
      height,
    };
  }

  /**
   * Insert a key (unique — duplicates are skipped). Returns the step
   * sequence for playback plus whether the mutation applied.
   */
  insert(key: number): MutationResult {
    const steps: BTreeStep[] = [];
    let seq = 0;
    const record = (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ): void => {
      steps.push({
        id: seq++,
        kind,
        label,
        snapshot: this.snapshot(),
        pathIds: [...pathIds],
        active,
      });
    };

    record("start", `Insert ${key}`, [], null);

    const path: MutableNode[] = [];
    let node = this.root;
    while (!node.leaf) {
      const i = lowerBound(node.keys, key);
      if (i < node.keys.length && node.keys[i] === key) {
        record(
          "duplicate",
          `${key} already indexed in page ${node.id} (B-Trees store unique keys)`,
          path.map((p) => p.id),
          { nodeId: node.id, keyIndex: i },
        );
        return { applied: false, key, steps };
      }
      const probeIdx = Math.min(i, node.keys.length - 1);
      record(
        "compare",
        probeIdx >= 0
          ? `Page ${node.id}: compare ${key} vs ${node.keys[probeIdx]}`
          : `Page ${node.id}: probe ${key}`,
        path.map((p) => p.id),
        { nodeId: node.id, keyIndex: probeIdx >= 0 ? probeIdx : undefined },
      );
      node = node.children[i];
      path.push(node);
      record(
        "descend",
        `Pointer hop → page ${node.id}`,
        path.map((p) => p.id),
        { nodeId: node.id },
      );
    }

    const i = lowerBound(node.keys, key);
    if (i < node.keys.length && node.keys[i] === key) {
      record(
        "duplicate",
        `${key} already indexed (B-Trees store unique keys)`,
        path.map((p) => p.id),
        { nodeId: node.id, keyIndex: i },
      );
      return { applied: false, key, steps };
    }

    node.keys.splice(i, 0, key);
    record(
      "insert",
      `Inserted ${key} into page ${node.id}`,
      path.map((p) => p.id),
      { nodeId: node.id, keyIndex: i },
    );

    if (node.keys.length > this.config.maxKeys) this.splitUp(node, record);
    return { applied: true, key, steps };
  }

  private splitUp(
    overflowed: MutableNode,
    record: (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ) => void,
  ): void {
    const pathFor = (node: MutableNode): string[] => {
      const ids: string[] = [];
      for (let cur: MutableNode | null = node; cur; cur = cur.parent) ids.push(cur.id);
      return ids;
    };
    let child = overflowed;
    for (;;) {
      const mid = Math.floor(child.keys.length / 2);
      const median = child.keys[mid];
      record(
        "overflow",
        `Page ${child.id} overflows (${child.keys.length} keys > ${this.config.maxKeys})`,
        pathFor(child),
        { nodeId: child.id },
      );

      const leftKeys = child.keys.slice(0, mid);
      const rightKeys = child.keys.slice(mid + 1);
      const leftChildren = child.children.slice(0, mid + 1);
      const rightChildren = child.children.slice(mid + 1);

      const right = BTree.freshLeaf(this.newId());
      right.keys = rightKeys;
      right.leaf = child.leaf;
      right.children = rightChildren;
      for (const r of rightChildren) r.parent = right;

      child.keys = leftKeys;
      child.children = leftChildren;

      record(
        "split",
        `Split page ${child.id}: median ${median} promoted`,
        pathFor(child),
        { nodeId: child.id },
      );

      if (child.parent) {
        const parent = child.parent;
        const idx = parent.children.indexOf(child);
        parent.keys.splice(idx, 0, median);
        parent.children.splice(idx + 1, 0, right);
        right.parent = parent;
        record(
          "promote",
          `${median} absorbed into page ${parent.id}`,
          pathFor(parent),
          { nodeId: parent.id },
        );
        if (parent.keys.length <= this.config.maxKeys) break;
        child = parent;
        continue;
      }

      const newRoot: MutableNode = {
        id: this.newId(),
        keys: [median],
        children: [child, right],
        parent: null,
        leaf: false,
      };
      child.parent = newRoot;
      right.parent = newRoot;
      this.root = newRoot;
      record(
        "root-up",
        `New root page ${newRoot.id} — tree grew one level`,
        [newRoot.id, child.id],
        { nodeId: newRoot.id },
      );
      break;
    }
  }

  /** Delete a key. Missing keys are a no-op. Returns steps + applied flag. */
  delete(key: number): MutationResult {
    const steps: BTreeStep[] = [];
    let seq = 0;
    const record = (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ): void => {
      steps.push({
        id: seq++,
        kind,
        label,
        snapshot: this.snapshot(),
        pathIds: [...pathIds],
        active,
      });
    };

    record("start", `Delete ${key}`, [], null);

    const path: MutableNode[] = [];
    const applied = this.deleteFrom(this.root, key, path, record);
    return { applied, key, steps };
  }

  private deleteFrom(
    node: MutableNode,
    key: number,
    path: MutableNode[],
    record: (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ) => void,
  ): boolean {
    path.push(node);
    const i = lowerBound(node.keys, key);

    if (i < node.keys.length && node.keys[i] === key) {
      record(
        "match",
        `Hit ${key} in page ${node.id}`,
        path.map((p) => p.id),
        { nodeId: node.id, keyIndex: i },
      );

      if (node.leaf) {
        node.keys.splice(i, 1);
        record(
          "remove",
          `Removed ${key} from page ${node.id}`,
          path.map((p) => p.id),
          { nodeId: node.id },
        );
        this.shrinkRoot();
        return true;
      }

      const left = node.children[i];
      const right = node.children[i + 1];
      if (left.keys.length >= this.config.t) {
        const pred = rightmost(left);
        const predKey = pred.keys[pred.keys.length - 1];
        node.keys[i] = predKey;
        record(
          "successor",
          `Replaced ${key} with predecessor ${predKey} (page ${pred.id})`,
          path.map((p) => p.id),
          { nodeId: node.id, keyIndex: i },
        );
        this.deleteFrom(left, predKey, path, record);
      } else if (right.keys.length >= this.config.t) {
        const succ = leftmost(right);
        const succKey = succ.keys[0];
        node.keys[i] = succKey;
        record(
          "successor",
          `Replaced ${key} with successor ${succKey} (page ${succ.id})`,
          path.map((p) => p.id),
          { nodeId: node.id, keyIndex: i },
        );
        this.deleteFrom(right, succKey, path, record);
      } else {
        this.mergeIntoLeft(node, i + 1, path.map((p) => p.id), record);
        this.deleteFrom(left, key, path, record);
      }
      this.shrinkRoot();
      return true;
    }

    if (node.leaf) {
      record(
        "not-found",
        `${key} is not indexed`,
        path.map((p) => p.id),
        { nodeId: node.id, keyIndex: node.keys.length ? Math.min(i, node.keys.length - 1) : undefined },
      );
      return false;
    }

    const targetIdx = this.ensureChild(node, i, path, record);
    record(
      "descend",
      `Pointer hop → page ${node.children[targetIdx].id}`,
      path.map((p) => p.id),
      { nodeId: node.children[targetIdx].id },
    );
    this.deleteFrom(node.children[targetIdx], key, path, record);
    this.shrinkRoot();
    return true;
  }

  /**
   * Guarantee page.children[i] holds >= t keys before we descend into it
   * (so the eventual leaf removal never underflows). Returns the index of
   * the (possibly merged/rotated) target child.
   */
  private ensureChild(
    node: MutableNode,
    i: number,
    path: MutableNode[],
    record: (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ) => void,
  ): number {
    const child = node.children[i];
    if (child.keys.length >= this.config.t) return i;

    const pathFor = (n: MutableNode): string[] => {
      const ids: string[] = [];
      for (let cur: MutableNode | null = n; cur; cur = cur.parent) ids.push(cur.id);
      for (const p of path) if (!ids.includes(p.id)) ids.push(p.id);
      return ids;
    };

    if (i + 1 < node.children.length && node.children[i + 1].keys.length >= this.config.t) {
      this.borrowFromRight(node, i, pathFor(node), record);
      return i;
    }
    if (i > 0 && node.children[i - 1].keys.length >= this.config.t) {
      this.borrowFromLeft(node, i, pathFor(node), record);
      return i;
    }

    if (i > 0) {
      this.mergeIntoLeft(node, i, pathFor(node), record);
      return i - 1;
    }
    this.mergeIntoLeft(node, i + 1, pathFor(node), record);
    return i;
  }

  private borrowFromRight(
    node: MutableNode,
    i: number,
    pathIds: string[],
    record: (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ) => void,
  ): void {
    const child = node.children[i];
    const sibling = node.children[i + 1];
    child.keys.push(node.keys[i]);
    node.keys[i] = sibling.keys.shift() as number;
    if (!child.leaf) {
      const moved = sibling.children.shift() as MutableNode;
      moved.parent = child;
      child.children.push(moved);
    }
    record(
      "borrow",
      `Redistribute: ${node.keys[i]} rotated down from page ${node.id}`,
      pathIds,
      { nodeId: child.id },
    );
  }

  private borrowFromLeft(
    node: MutableNode,
    i: number,
    pathIds: string[],
    record: (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ) => void,
  ): void {
    const child = node.children[i];
    const sibling = node.children[i - 1];
    child.keys.unshift(node.keys[i - 1]);
    node.keys[i - 1] = sibling.keys.pop() as number;
    if (!child.leaf) {
      const moved = sibling.children.pop() as MutableNode;
      moved.parent = child;
      child.children.unshift(moved);
    }
    record(
      "borrow",
      `Redistribute: ${node.keys[i - 1]} rotated down from page ${node.id}`,
      pathIds,
      { nodeId: child.id },
    );
  }

  /** Merge children[i-1] + node.keys[i-1] + children[i] into a single page. */
  private mergeIntoLeft(
    node: MutableNode,
    i: number,
    pathIds: string[],
    record: (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ) => void,
  ): void {
    const left = node.children[i - 1];
    const right = node.children[i];
    const pivot = node.keys[i - 1];

    left.keys.push(pivot, ...right.keys);
    for (const c of right.children) c.parent = left;
    left.children.push(...right.children);
    node.keys.splice(i - 1, 1);
    node.children.splice(i, 1);

    record(
      "merge",
      `Merge: ${pivot} absorbed, pages ${left.id} + ${right.id} combined`,
      pathIds,
      { nodeId: left.id },
    );
  }

  /** If the root lost its last key, promote its single child (if any). */
  private shrinkRoot(): void {
    if (this.root.keys.length === 0 && this.root.children.length === 1) {
      this.root = this.root.children[0];
      this.root.parent = null;
    }
  }

  /** Point lookup with hop recording; also yields the O(N) comparator count. */
  search(key: number): { steps: BTreeStep[]; result: SearchResult } {
    const steps: BTreeStep[] = [];
    let seq = 0;
    const record = (
      kind: StepKind,
      label: string,
      pathIds: string[],
      active: BTreeStepActive | null,
    ): void => {
      steps.push({
        id: seq++,
        kind,
        label,
        snapshot: this.snapshot(),
        pathIds: [...pathIds],
        active,
      });
    };
    const totalKeys = this.snapshot().totalKeys;

    record("start", `Lookup ${key}`, [], null);

    let node = this.root;
    let hops = 0;
    const path: string[] = [];
    for (;;) {
      hops += 1;
      path.push(node.id);
      const i = lowerBound(node.keys, key);
      const probeIdx = Math.min(i, node.keys.length - 1);
      if (i < node.keys.length && node.keys[i] === key) {
        record(
          "found",
          `Found ${key} in page ${node.id} after ${hops} hop${hops === 1 ? "" : "s"}`,
          path,
          { nodeId: node.id, keyIndex: i },
        );
        return {
          steps,
          result: { found: true, key, hops, seqSteps: totalKeys },
        };
      }
      record(
        node.leaf ? "not-found" : "compare",
        node.leaf
          ? `${key} not in page ${node.id} — lookup ends`
          : `Page ${node.id}: compare ${key} vs ${
              probeIdx >= 0 ? node.keys[probeIdx] : "end"
            }`,
        path,
        { nodeId: node.id, keyIndex: probeIdx >= 0 ? probeIdx : undefined },
      );
      if (node.leaf) {
        return {
          steps,
          result: { found: false, key, hops, seqSteps: totalKeys },
        };
      }
      node = node.children[i];
      record("descend", `Pointer hop → page ${node.id}`, path, {
        nodeId: node.id,
      });
    }
  }
}

/** Fill-factor and page-count statistics for the overhead callout. */
export interface BTreeStats {
  keyCount: number;
  nodeCount: number;
  height: number;
  avgFillPct: number;
  minFillPct: number;
  maxFillPct: number;
  /** Rough index storage estimate (keys + child pointers + page headers). */
  estBytes: number;
}

export function snapshotStats(snapshot: BTreeSnapshot): BTreeStats {
  const { maxKeys } = snapshot.config;
  const fills = snapshot.nodes.map((n) => n.keys.length / maxKeys);
  const minFill = fills.length ? Math.min(...fills) : 0;
  const maxFill = fills.length ? Math.max(...fills) : 0;
  const avgFill = fills.length
    ? fills.reduce((a, b) => a + b, 0) / fills.length
    : 0;
  const internalPtrs = snapshot.nodes.reduce(
    (sum, n) => sum + n.childIds.length,
    0,
  );
  const estBytes =
    snapshot.nodes.length * 24 + snapshot.totalKeys * 8 + internalPtrs * 8;
  return {
    keyCount: snapshot.totalKeys,
    nodeCount: snapshot.nodes.length,
    height: snapshot.height,
    avgFillPct: avgFill * 100,
    minFillPct: minFill * 100,
    maxFillPct: maxFill * 100,
    estBytes,
  };
}

/** Insert `count` unique random keys in range [min, max]; skips existing. */
export function insertRandomKeys(
  tree: BTree,
  count: number,
  min = 1,
  max = 399,
): { steps: BTreeStep[]; inserted: number; skipped: number } {
  const steps: BTreeStep[] = [];
  const seen = new Set<number>();
  const existing = new Set<number>();
  for (const node of tree.snapshot().nodes) for (const k of node.keys) existing.add(k);

  let inserted = 0;
  let skipped = 0;
  let attempts = 0;
  while (inserted < count && attempts < count * 40) {
    attempts += 1;
    const key = min + Math.floor(Math.random() * (max - min + 1));
    if (seen.has(key) || existing.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    const res = tree.insert(key);
    steps.push(...res.steps);
    if (res.applied) inserted += 1;
  }
  return { steps, inserted, skipped };
}