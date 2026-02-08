// Socket type definitions and visual styles

import type { SocketTypeId, SocketShape, Parameter } from './types';

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
