import type { FlowEdge, FlowNode, NodeDefinition, Parameter } from '@nodes/_types';

const DEFAULT_MIN = 1;

export function isAutoExpandParam(param: Parameter): boolean {
  return Boolean(param.autoExpand) && Boolean(param.socket) && param.mode !== 'output';
}

export function getAutoExpandHandleId(baseId: string, index: number): string {
  if (index <= 1) return baseId;
  return `${baseId}_${index}`;
}

export function getAutoExpandHandleIndex(
  baseId: string,
  handleId: string | null | undefined
): number | null {
  if (!handleId) return null;
  if (handleId === baseId) return 1;
  if (!handleId.startsWith(`${baseId}_`)) return null;

  const raw = handleId.slice(baseId.length + 1);
  const index = Number.parseInt(raw, 10);
  if (!Number.isFinite(index) || index < 1) return null;
  return index;
}

export function resolveNodeParameters(
  definition: NodeDefinition,
  node: FlowNode,
  edges: FlowEdge[] = []
): Parameter[] {
  const resolved: Parameter[] = [];

  for (const param of definition.parameters) {
    if (!isAutoExpandParam(param)) {
      resolved.push(param);
      continue;
    }

    const count = getAutoExpandCount(param, node.id, edges);
    for (let index = 1; index <= count; index += 1) {
      resolved.push(buildAutoExpandParam(param, index));
    }
  }

  return resolved;
}

export function resolveParameterForHandle(
  definition: NodeDefinition,
  handleId: string | null | undefined
): Parameter | undefined {
  if (!handleId) return undefined;

  const direct = definition.parameters.find(param => param.id === handleId);
  if (direct) return direct;

  for (const param of definition.parameters) {
    if (!isAutoExpandParam(param)) continue;
    const index = getAutoExpandHandleIndex(param.id, handleId);
    if (index === null) continue;
    return buildAutoExpandParam(param, index);
  }

  return undefined;
}

function normalizeMin(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MIN;
  }
  return Math.floor(value);
}

function normalizeMax(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor(value);
}

function getAutoExpandCount(
  param: Parameter,
  nodeId: string,
  edges: FlowEdge[]
): number {
  const min = normalizeMin(param.autoExpand?.min);
  const max = normalizeMax(param.autoExpand?.max);
  const connected = getConnectedAutoExpandIndices(param, nodeId, edges);
  const maxIndex = connected.size ? Math.max(...connected) : 0;
  const effectiveMax = Number.isFinite(max) ? Math.max(max, min, maxIndex) : Number.POSITIVE_INFINITY;

  let count = Math.max(min, maxIndex);
  if (count < effectiveMax && !hasOpenSlot(connected, count)) {
    count += 1;
  }

  return Math.min(count, effectiveMax);
}

function getConnectedAutoExpandIndices(
  param: Parameter,
  nodeId: string,
  edges: FlowEdge[]
): Set<number> {
  const connected = new Set<number>();
  if (!edges.length) return connected;

  const useOutgoing = param.mode === 'output';

  for (const edge of edges) {
    if (useOutgoing) {
      if (edge.source !== nodeId) continue;
    } else {
      if (edge.target !== nodeId) continue;
    }

    const handleId = useOutgoing ? edge.sourceHandle : edge.targetHandle;
    const index = getAutoExpandHandleIndex(param.id, handleId);
    if (index !== null) {
      connected.add(index);
    }
  }

  return connected;
}

function hasOpenSlot(connected: Set<number>, count: number): boolean {
  for (let index = 1; index <= count; index += 1) {
    if (!connected.has(index)) return true;
  }
  return false;
}

function buildAutoExpandParam(param: Parameter, index: number): Parameter {
  const id = getAutoExpandHandleId(param.id, index);
  const label = `${param.label} ${index}`;
  return {
    ...param,
    id,
    label,
    autoExpand: undefined,
  };
}
