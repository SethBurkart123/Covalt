import type { FlowEdge } from '@/lib/flow';

export interface GraphTraversalOptions {
  stopAt?: Set<string>;
  includeStopNodes?: boolean;
}

function buildAdjacency(edges: FlowEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  return adjacency;
}

function buildReverseAdjacency(edges: FlowEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    const list = adjacency.get(edge.target) ?? [];
    list.push(edge.source);
    adjacency.set(edge.target, list);
  }
  return adjacency;
}

export function filterFlowEdges(edges: FlowEdge[]): FlowEdge[] {
  return edges.filter(edge => edge.data?.channel === 'flow');
}

export function downstreamClosure(
  startIds: Iterable<string>,
  edges: FlowEdge[],
  options: GraphTraversalOptions = {}
): Set<string> {
  const adjacency = buildAdjacency(edges);
  const stopAt = options.stopAt ?? new Set<string>();
  const includeStop = options.includeStopNodes ?? false;

  const visited = new Set<string>();
  const queue = Array.from(startIds);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;

    if (stopAt.has(nodeId)) {
      if (includeStop) visited.add(nodeId);
      continue;
    }

    visited.add(nodeId);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  return visited;
}

export function upstreamClosure(
  startIds: Iterable<string>,
  edges: FlowEdge[],
  options: GraphTraversalOptions = {}
): Set<string> {
  const adjacency = buildReverseAdjacency(edges);
  const stopAt = options.stopAt ?? new Set<string>();
  const includeStop = options.includeStopNodes ?? false;

  const visited = new Set<string>();
  const queue = Array.from(startIds);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;

    if (stopAt.has(nodeId)) {
      if (includeStop) visited.add(nodeId);
      continue;
    }

    visited.add(nodeId);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const next of neighbors) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  return visited;
}
