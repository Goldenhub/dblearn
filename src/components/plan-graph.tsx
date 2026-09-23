"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type NodeMouseHandler } from "@xyflow/react";
import dagre from "@dagrejs/dagre";

import type { DuckDBExplainResult } from "@/lib/duckdb/protocol";
import {
  buildPlanModel,
  edgeStrokeWidth,
  findMaxCardinality,
  type PlanEdge,
  type PlanFlowNode,
} from "@/lib/parser/planMapper";
import CustomPlanNode from "@/components/nodes/CustomPlanNode";
import PlanInspector from "@/components/PlanInspector";

const NODE_WIDTH = 228;
const NODE_HEIGHT = 104;

const nodeTypes = { plan: CustomPlanNode };

function layoutWithDagre(nodes: PlanFlowNode[], edges: PlanEdge[]): PlanFlowNode[] {
  if (nodes.length === 0) return nodes;
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "TB",
    nodesep: 48,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    return {
      ...node,
      position: {
        x: positioned.x - positioned.width / 2,
        y: positioned.y - positioned.height / 2,
      },
    };
  });
}

function formatCardinality(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export function PlanGraph({ result }: { result: DuckDBExplainResult | null }) {
  const [selection, setSelection] = useState<PlanFlowNode | null>(null);

  const { nodes, edges } = useMemo(
    () => (result ? buildPlanModel(result.plan) : { nodes: [], edges: [] }),
    [result],
  );

  const layouted = useMemo(
    () => (result ? layoutWithDagre(nodes, edges) : []),
    [result, nodes, edges],
  );

  const maxCardinality = useMemo(() => findMaxCardinality(edges), [edges]);

  const visibleEdges = useMemo(
    () =>
      edges.map((edge) => {
        const cardinality = edge.data?.cardinality ?? null;
        const width = edgeStrokeWidth(cardinality, maxCardinality);
        return {
          ...edge,
          style: {
            strokeWidth: width,
            stroke:
              cardinality !== null && cardinality >= maxCardinality && maxCardinality > 0
                ? "#34d399"
                : "#8b5cf6",
          },
          label:
            cardinality === null ? undefined : formatCardinality(cardinality),
          labelStyle: { fill: "#a1a1aa", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#18181b", fillOpacity: 0.9 },
        };
      }),
    [edges, maxCardinality],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => setSelection(node as PlanFlowNode),
    [],
  );

  // Close the drawer when a new plan arrives.
  useEffect(() => {
    const timer = setTimeout(() => setSelection(null), 0);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        <div className="max-w-sm text-center leading-6">
          <p className="font-medium text-zinc-600">No plan yet</p>
          <p>Write SQL on the left and press Run — the execution plan will render here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={layouted}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable
        nodesConnectable={false}
        minZoom={0.2}
        maxZoom={1.6}
        panActivationKeyCode={null}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-950"
      >
        <Background color="#3f3f46" gap={24} />
        <Controls className="!bg-zinc-900 [&>button]:!border-zinc-700 [&>button]:!bg-zinc-900" />
      </ReactFlow>

      {selection ? (
        <PlanInspector
          node={selection.data}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </div>
  );
}