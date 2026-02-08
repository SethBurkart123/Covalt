// Socket type definitions and visual styles

import type { SocketTypeId, SocketShape, Parameter } from '@nodes/_types';

export interface SocketType {
  id: SocketTypeId;
  color: string;
  shape: SocketShape;
}

// Socket type registry - visual config only
export const SOCKET_TYPES: Record<SocketTypeId, SocketType> = {
  agent: {
    id: 'agent',
    color: '#7c3aed',
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
  color: {
    id: 'color',
    color: '#eab308',
    shape: 'circle',
  },
  json: {
    id: 'json',
    color: '#f97316',
    shape: 'circle',
  },
  text: {
    id: 'text',
    color: '#06b6d4',
    shape: 'circle',
  },
  binary: {
    id: 'binary',
    color: '#ec4899',
    shape: 'square',
  },
  array: {
    id: 'array',
    color: '#8b5cf6',
    shape: 'square',
  },
  message: {
    id: 'message',
    color: '#a855f7',
    shape: 'circle',
  },
  document: {
    id: 'document',
    color: '#84cc16',
    shape: 'square',
  },
  vector: {
    id: 'vector',
    color: '#14b8a6',
    shape: 'diamond',
  },
  trigger: {
    id: 'trigger',
    color: '#ef4444',
    shape: 'diamond',
  },
  any: {
    id: 'any',
    color: '#6b7280',
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

  // Primitives → string
  'int:string',
  'float:string',
  'boolean:string',

  // string ↔ text are identity (same data, different semantic)
  'string:text',
  'text:string',

  // Structured → string/text (serialize)
  'json:string',
  'json:text',

  // Message unpacking
  'message:text',
  'message:string',
  'message:json',

  // Document unpacking
  'document:text',
  'document:json',
]);

/** Check if sourceType can implicitly coerce to targetType. */
export function canCoerce(sourceType: SocketTypeId, targetType: SocketTypeId): boolean {
  if (sourceType === targetType) return true;
  if (targetType === 'any') return true;
  if (sourceType === 'any') return true;
  return IMPLICIT_COERCIONS.has(`${sourceType}:${targetType}`);
}

/**
 * Can a source socket connect to a target parameter?
 *
 * Priority:
 *   1. If the target has an explicit `acceptsTypes` list, only those types are allowed.
 *   2. Otherwise, check exact match or implicit coercion.
 */
export function canConnect(sourceType: SocketTypeId, targetParam: Parameter): boolean {
  const targetType = targetParam.socket?.type ?? (targetParam.type as SocketTypeId);

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
