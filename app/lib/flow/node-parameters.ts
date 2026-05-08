import type { FlowEdge, FlowNode, NodeDefinition, Parameter } from '@nodes/_types';
import {
  variableLinkHandle,
  type OptionsSource,
  type VariableSpec,
} from '@nodes/_variables';

const DEFAULT_MIN = 1;

function isAutoExpandParam(param: Parameter): boolean {
  return Boolean(param.autoExpand) && Boolean(param.socket) && param.mode !== 'output';
}

function getAutoExpandHandleId(baseId: string, index: number): string {
  if (index <= 1) return baseId;
  return `${baseId}_${index}`;
}

function getAutoExpandHandleIndex(
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
    if (param.type === 'variables') {
      resolved.push(param);
      const specs = readVariableSpecs(node.data?.[param.id]);
      for (const socketParam of variableLinkSocketParams(specs)) {
        resolved.push(socketParam);
      }
      continue;
    }

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

function readVariableSpecs(raw: unknown): VariableSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is VariableSpec =>
      typeof entry === 'object' && entry !== null && typeof (entry as VariableSpec).id === 'string'
  );
}

function variableLinkSocketParams(specs: VariableSpec[]): Parameter[] {
  const sockets: Parameter[] = [];
  for (const spec of specs) {
    const source = spec.options;
    if (!source || source.kind !== 'link') continue;
    sockets.push(buildVariableLinkSocket(spec, source));
  }
  return sockets;
}

function buildVariableLinkSocket(
  spec: VariableSpec,
  source: Extract<OptionsSource, { kind: 'link' }>,
): Parameter {
  const socket: Parameter = {
    id: variableLinkHandle(spec.id),
    type: 'data',
    label: spec.label,
    mode: 'input',
    socket: {
      type: source.socketType || 'data',
      side: 'left',
      channel: 'link',
      shape: 'diamond',
    },
  };
  return socket;
}

export function resolveParameterForHandle(
  definition: NodeDefinition,
  handleId: string | null | undefined,
  node?: FlowNode
): Parameter | undefined {
  if (!handleId) return undefined;

  const direct = definition.parameters.find(param => param.id === handleId);
  if (direct) return direct;

  for (const param of definition.parameters) {
    if (isAutoExpandParam(param)) {
      const index = getAutoExpandHandleIndex(param.id, handleId);
      if (index === null) continue;
      return buildAutoExpandParam(param, index);
    }

    if (param.type === 'variables' && node) {
      const specs = readVariableSpecs(node.data?.[param.id]);
      for (const socket of variableLinkSocketParams(specs)) {
        if (socket.id === handleId) return socket;
      }
    }
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
