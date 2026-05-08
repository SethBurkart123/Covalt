import type { Edge, Node } from "@xyflow/react";
import type { GraphData, GraphEdge, GraphNode } from "@/python/api";

export function flowToGraphData(nodes: Node[], edges: Edge[]): GraphData {
  return { nodes: nodes.map(toGraphNode), edges: edges.map(toGraphEdge) };
}

function toGraphNode(node: Node): GraphNode {
  return {
    id: node.id,
    type: node.type ?? "unknown",
    position: node.position,
    data: (node.data ?? {}) as Record<string, unknown>,
  };
}

function toGraphEdge(edge: Edge): GraphEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? undefined,
    target: edge.target,
    targetHandle: edge.targetHandle ?? undefined,
    data: (edge.data ?? {}) as unknown as GraphEdge["data"],
  };
}
