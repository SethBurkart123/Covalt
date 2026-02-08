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

export function canConnect(sourceType: SocketTypeId, targetParam: Parameter): boolean {
  const targetType = targetParam.socket?.type ?? (targetParam.type as SocketTypeId);
  
  if (targetParam.acceptsTypes) {
    return targetParam.acceptsTypes.includes(sourceType);
  }
  
  return sourceType === targetType;
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
