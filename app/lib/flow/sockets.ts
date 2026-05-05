import type { SocketTypeId, SocketShape, Parameter } from '@nodes/_types';

export interface SocketType {
  id: string;
  color: string;
  shape: SocketShape;
}

const socketTypeRegistry = new Map<string, SocketType>();
const coercionRegistry = new Set<string>();
const pluginSocketTypes = new Map<string, string[]>();
const pluginCoercions = new Map<string, string[]>();

const BUILTIN_SOCKET_TYPES: Record<string, SocketType> = {
  data: { id: 'data', color: '#94a3b8', shape: 'circle' },
  tools: { id: 'tools', color: '#f59e0b', shape: 'square' },
  float: { id: 'float', color: '#a1a1aa', shape: 'circle' },
  int: { id: 'int', color: '#71717a', shape: 'circle' },
  string: { id: 'string', color: '#3b82f6', shape: 'circle' },
  boolean: { id: 'boolean', color: '#10b981', shape: 'diamond' },
  json: { id: 'json', color: '#f97316', shape: 'circle' },
  model: { id: 'model', color: '#06b6d4', shape: 'circle' },
};

const BUILTIN_COERCIONS: string[] = [
  'int:float',
  'int:string',
  'float:string',
  'boolean:string',
  'json:string',
];

for (const [id, config] of Object.entries(BUILTIN_SOCKET_TYPES)) {
  socketTypeRegistry.set(id, config);
}
for (const pair of BUILTIN_COERCIONS) {
  coercionRegistry.add(pair);
}

export function registerSocketType(socketType: SocketType, pluginId?: string): void {
  socketTypeRegistry.set(socketType.id, socketType);
  if (pluginId) {
    const existing = pluginSocketTypes.get(pluginId) ?? [];
    existing.push(socketType.id);
    pluginSocketTypes.set(pluginId, existing);
  }
}

export function registerCoercion(source: string, target: string, pluginId?: string): void {
  const key = `${source}:${target}`;
  coercionRegistry.add(key);
  if (pluginId) {
    const existing = pluginCoercions.get(pluginId) ?? [];
    existing.push(key);
    pluginCoercions.set(pluginId, existing);
  }
}

export function deregisterPluginSocketTypes(pluginId: string): void {
  for (const typeId of pluginSocketTypes.get(pluginId) ?? []) {
    socketTypeRegistry.delete(typeId);
  }
  pluginSocketTypes.delete(pluginId);

  for (const key of pluginCoercions.get(pluginId) ?? []) {
    coercionRegistry.delete(key);
  }
  pluginCoercions.delete(pluginId);
}

export const SOCKET_TYPES: Record<string, SocketType> = new Proxy(
  {} as Record<string, SocketType>,
  {
    get: (_target, prop) =>
      typeof prop === 'string' ? socketTypeRegistry.get(prop) : undefined,
    has: (_target, prop) =>
      typeof prop === 'string' ? socketTypeRegistry.has(prop) : false,
    ownKeys: () => Array.from(socketTypeRegistry.keys()),
    getOwnPropertyDescriptor: (_target, prop) => {
      if (typeof prop !== 'string' || !socketTypeRegistry.has(prop)) return undefined;
      return { enumerable: true, configurable: true, value: socketTypeRegistry.get(prop), writable: false };
    },
  }
);

export function canCoerce(sourceType: SocketTypeId, targetType: SocketTypeId): boolean {
  if (sourceType === targetType) return true;
  return coercionRegistry.has(`${sourceType}:${targetType}`);
}

export function canConnect(sourceType: SocketTypeId, targetParam: Parameter): boolean {
  const targetType = targetParam.socket?.type ?? (targetParam.type as SocketTypeId);

  if (sourceType === 'data') {
    if (targetType === 'data') return true;
    if (targetParam.acceptsTypes?.includes('data')) return true;
    return false;
  }

  if (targetType === 'data') {
    if (targetParam.acceptsTypes?.includes(sourceType)) return true;
    return false;
  }

  if (targetParam.acceptsTypes) {
    return targetParam.acceptsTypes.includes(sourceType);
  }

  return canCoerce(sourceType, targetType);
}

export function getSocketStyle(
  typeId: SocketTypeId,
  overrides?: { color?: string; shape?: SocketShape }
): { color: string; shape: SocketShape } {
  const base = socketTypeRegistry.get(typeId);
  return {
    color: overrides?.color ?? base?.color ?? '#a1a1aa',
    shape: overrides?.shape ?? base?.shape ?? 'circle',
  };
}

export function resetSocketRegistryForTests(): void {
  socketTypeRegistry.clear();
  coercionRegistry.clear();
  pluginSocketTypes.clear();
  pluginCoercions.clear();
  for (const [id, config] of Object.entries(BUILTIN_SOCKET_TYPES)) {
    socketTypeRegistry.set(id, config);
  }
  for (const pair of BUILTIN_COERCIONS) {
    coercionRegistry.add(pair);
  }
}
