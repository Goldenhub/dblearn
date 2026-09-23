"use client";

/**
 * Phase 3 — SVG renderer for a B-Tree snapshot.
 *
 * Each page is a rounded "row" of key chips; blocker pointer edges fan down
 * between a page and its children. Lookup playback highlights the visited
 * pointer path in amber, the compared key chip brighter, and mutation steps
 * tint the touched page (emerald = growth/split, red = overflow/removal,
 * sky = redistribute/merge). Node groups move with a CSS transform
 * transition so split/merge snapshots animate smoothly.
 */

import { useMemo, type CSSProperties } from "react";
import type { BTreeSnapshot, BTreeStepActive, StepKind } from "@/lib/engine/btree";

const KEY_W = 40;
const KEY_H = 26;
const KEY_GAP = 8;
const NODE_PAD_X = 12;
const NODE_PAD_Y = 10;
const ROW_H = 96;
const SUBTREE_GAP = 30;
const TOP_PAD = 30;
const PAD = 40;

interface NodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

interface LayoutResult {
  width: number;
  height: number;
  boxes: Map<string, NodeBox>;
}

function boxWidthFor(n: { keys: unknown[] }): number {
  const chips =
    n.keys.length > 0
      ? n.keys.length * KEY_W + (n.keys.length - 1) * KEY_GAP
      : KEY_W;
  return chips + 2 * NODE_PAD_X;
}

function computeLayout(snapshot: BTreeSnapshot): LayoutResult {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const boxes = new Map<string, NodeBox>();
  let maxDepth = 0;

  const place = (nodeId: string, xLeft: number, depth: number): number => {
    const node = byId.get(nodeId);
    if (!node) return 0;
    maxDepth = Math.max(maxDepth, depth);
    if (node.leaf) {
      const w = boxWidthFor(node);
      boxes.set(nodeId, {
        x: xLeft + w / 2,
        y: depth * ROW_H + TOP_PAD,
        w,
        h: NODE_PAD_Y * 2 + KEY_H,
        depth,
      });
      return w;
    }
    let cursor = xLeft;
    const centers: number[] = [];
    for (let i = 0; i < node.childIds.length; i++) {
      const w = place(node.childIds[i], cursor, depth + 1);
      centers.push(cursor + w / 2);
      cursor += w + (i < node.childIds.length - 1 ? SUBTREE_GAP : 0);
    }
    const cx = centers.length
      ? (centers[0] + centers[centers.length - 1]) / 2
      : xLeft;
    boxes.set(nodeId, {
      x: cx,
      y: depth * ROW_H + TOP_PAD,
      w: boxWidthFor(node),
      h: NODE_PAD_Y * 2 + KEY_H,
      depth,
    });
    const span = Math.max(cursor - xLeft, boxWidthFor(node));
    return span;
  };

  const root = byId.get(snapshot.rootId);
  const total = root ? place(root.id, 0, 0) : 0;
  const contentWidth = Math.max(total, 560);
  for (const b of boxes.values()) b.x += PAD;
  return {
    width: contentWidth + PAD * 2,
    height: (maxDepth + 1) * ROW_H + TOP_PAD + 20,
    boxes,
  };
}

/** Accent color per step category — drives the touched-page ring. */
export function stepAccent(kind: StepKind): { ring: string; text: string } {
  switch (kind) {
    case "overflow":
      return { ring: "#f43f5e", text: "text-rose-600 dark:text-rose-400" };
    case "insert":
    case "split":
    case "promote":
    case "root-up":
      return { ring: "#34d399", text: "text-emerald-600 dark:text-emerald-400" };
    case "merge":
    case "borrow":
    case "root-down":
    case "remove":
      return { ring: "#38bdf8", text: "text-sky-700 dark:text-sky-400" };
    case "compare":
    case "descend":
    case "match":
    case "found":
    case "not-found":
    case "duplicate":
    case "start":
      return { ring: "#fbbf24", text: "text-amber-600 dark:text-amber-400" };
    default:
      return { ring: "#a1a1aa", text: "text-zinc-400" };
  }
}

interface BTreeCanvasProps {
  snapshot: BTreeSnapshot;
  active: BTreeStepActive | null;
  pathIds: string[];
  kind: StepKind;
}

export default function BTreeCanvas({
  snapshot,
  active,
  pathIds,
  kind,
}: BTreeCanvasProps) {
  const layout = useMemo(() => computeLayout(snapshot), [snapshot]);
  const pathSet = useMemo(() => new Set(pathIds), [pathIds]);
  const accent = stepAccent(kind);

  const edges: { id: string; from: NodeBox; to: NodeBox; toId: string }[] = [];
  for (const node of snapshot.nodes) {
    const parentBox = layout.boxes.get(node.id);
    if (!parentBox) continue;
    for (const cid of node.childIds) {
      const childBox = layout.boxes.get(cid);
      if (!childBox) continue;
      edges.push({
        id: `${node.id}->${cid}`,
        from: parentBox,
        to: childBox,
        toId: cid,
      });
    }
  }

  const nodeTransform = (box: NodeBox): CSSProperties => ({
    transform: `translate(${box.x - box.w / 2}px, ${box.y}px)`,
  });

  const keyChipX = (box: NodeBox, i: number): number =>
    NODE_PAD_X + i * (KEY_W + KEY_GAP);

  return (
    <div className="h-full w-full overflow-auto bg-zinc-950 p-2">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block max-w-full h-auto"
        role="img"
        aria-label={`B-Tree with ${snapshot.totalKeys} keys across ${snapshot.nodes.length} pages`}
      >
        <defs>
          <marker
            id="btree-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-current" />
          </marker>
        </defs>

        {edges.map((edge) => {
          const y1 = edge.from.y + edge.from.h;
          const y2 = edge.to.y;
          const inPath = pathSet.has(edge.toId);
          return (
            <g
              key={edge.id}
              className={inPath ? "text-amber-600 dark:text-amber-400" : "text-zinc-600"}
            >
              <line
                x1={edge.from.x}
                y1={y1}
                x2={edge.to.x}
                y2={y2}
                stroke="currentColor"
                strokeWidth={inPath ? 2 : 1.25}
                strokeDasharray={inPath ? undefined : "3 3"}
                markerEnd={inPath ? "url(#btree-arrow)" : undefined}
              />
            </g>
          );
        })}

        {snapshot.nodes.map((node) => {
          const box = layout.boxes.get(node.id)!;
          const isPath = pathSet.has(node.id);
          const isActive = active?.nodeId === node.id;
          const ringColor = isActive ? accent.ring : isPath ? "#fbbf24" : "#3f3f46";
          const ringWidth = isActive ? 3 : isPath ? 1.75 : 1;
          const fill = isActive
            ? "rgba(251,191,36,0.08)"
            : isPath
              ? "rgba(251,191,36,0.05)"
              : "#18181b";
          const isPathGroup = isPath || isActive;

          return (
            <g
              key={node.id}
              style={{ ...nodeTransform(box), transition: "transform 0.5s ease" }}
            >
              <rect
                x={0}
                y={0}
                width={box.w}
                height={box.h}
                rx={10}
                fill={fill}
                stroke={ringColor}
                strokeWidth={ringWidth}
              />
              {node.keys.map((key, i) => {
                const hot = isActive && active?.keyIndex === i;
                return (
                  <g key={`${node.id}-${i}`} style={{ transition: "transform 0.45s ease" }}>
                    <rect
                      x={keyChipX(box, i)}
                      y={NODE_PAD_Y}
                      width={KEY_W}
                      height={KEY_H}
                      rx={6}
                      className="transition-colors duration-300"
                      fill={hot ? "#fbbf24" : "#27272a"}
                      stroke={hot ? "#f59e0b" : "#3f3f46"}
                    />
                    <text
                      x={keyChipX(box, i) + KEY_W / 2}
                      y={NODE_PAD_Y + KEY_H / 2 + 3.5}
                      textAnchor="middle"
                      fontSize={13}
                      fontWeight={hot ? 800 : 600}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fill={hot ? "#18181b" : "#e4e4e7"}
                    >
                      {key}
                    </text>
                  </g>
                );
              })}
              {node.keys.length === 0 ? (
                <text
                  x={box.w / 2}
                  y={NODE_PAD_Y + KEY_H / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={13}
                  fill="#71717a"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  ∅
                </text>
              ) : null}
              <text
                x={box.w / 2}
                y={box.h + 6}
                textAnchor="middle"
                fontSize={9}
                fill={isPathGroup ? "#b45309" : "#52525b"}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {node.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Alias per the Phase 3 deliverable naming (BTreeVisualizer.tsx). */
export const BTreeVisualizer = BTreeCanvas;