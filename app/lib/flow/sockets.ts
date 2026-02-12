// Socket type definitions and visual styles

import type { SocketTypeId, SocketShape, Parameter } from '@nodes/_types';

export interface SocketType {
  id: SocketTypeId;
  color: string;
  shape: SocketShape;
}

// Socket type registry - visual config only
export const SOCKET_TYPES: Record<SocketTypeId, SocketType> = {
  data: {
    id: 'data',
    color: '#94a3b8',
    shape: 'circle',
  },
  tools: {
    id: 'tools',
    color: '#f59e0b',
    shape: 'square',
  },
  float: {
    id: 'float',
    color: '#a1a1aa',
    shape: 'circle',
  },
  int: {
    id: 'int',
    color: '#71717a',
    shape: 'circle',
  },
  string: {
    id: 'string',
    color: '#3b82f6',
    shape: 'circle',
  },
  boolean: {
    id: 'boolean',
    color: '#10b981',
    shape: 'diamond',
  },
  json: {
    id: 'json',
    color: '#f97316',
    shape: 'circle',
  },
  model: {
    id: 'model',
    color: '#06b6d4',
    shape: 'circle',
  },
} as const;

// Implicit type coercion table.
// Each entry means "source can safely connect to target without an explicit converter."
// The coercion functions live in Python (nodes/_coerce.py) — this table is just for
// editor-time validation. Keep both in sync.
const IMPLICIT_COERCIONS = new Set<`${SocketTypeId}:${SocketTypeId}`>([
  // Numeric widening
  'int:float',

  // Primitives → string (serialize)
  'int:string',
  'float:string',
  'boolean:string',

  // Structured → string (serialize)
  'json:string',

]);

/** Check if sourceType can implicitly coerce to targetType. */
export function canCoerce(sourceType: SocketTypeId, targetType: SocketTypeId): boolean {
  if (sourceType === targetType) return true;
  return IMPLICIT_COERCIONS.has(`${sourceType}:${targetType}`);
}

/**
 * Can a source socket connect to a target parameter?
 *
 * Priority:
 *   1. Data spine: data → data always works
 *   2. Data → non-data: allowed if target's acceptsTypes includes 'data' (e.g. sub-agent composition)
 *   3. Non-data → data: blocked
 *   4. Typed sockets: check acceptsTypes or implicit coercion
 */
export function canConnect(sourceType: SocketTypeId, targetParam: Parameter): boolean {
  const targetType = targetParam.socket?.type ?? (targetParam.type as SocketTypeId);

  if (sourceType === 'data') {
    if (targetType === 'data') return true;
    if (targetParam.acceptsTypes?.includes('data')) return true;
    return false;
  }

  if (targetType === 'data') return false;

  if (targetParam.acceptsTypes) {
    return targetParam.acceptsTypes.includes(sourceType);
  }

  return canCoerce(sourceType, targetType);
}

export function getSocketStyle(
  typeId: SocketTypeId,
  overrides?: { color?: string; shape?: SocketShape }
): { color: string; shape: SocketShape } {
  const base = SOCKET_TYPES[typeId];
  return {
    color: overrides?.color ?? base?.color ?? '#a1a1aa',
    shape: overrides?.shape ?? base?.shape ?? 'circle',
  };
}
