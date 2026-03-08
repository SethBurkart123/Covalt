import type {
  FrontendHookContextMap,
  FrontendHookHandler,
  FrontendHookHandlers,
  FrontendHookResultMap,
  FrontendHookType,
  NodeDefinition,
} from '@nodes/_types';
import type { NodeEntry, PluginManifest } from '@nodes/_manifest';
import { deregisterHooks, registerHook, resetHooksForTests } from './plugin-hooks';

export interface NodeDefinitionMetadata {
  nodeType: string;
  definitionModule: string;
  runtimeModule: string;
}

interface RegisteredNode {
  pluginId: string;
  entry: NodeEntry;
  definition: NodeDefinition;
}

interface RegisteredPlugin {
  nodeTypes: string[];
}

const plugins = new Map<string, RegisteredPlugin>();
const nodesByType = new Map<string, RegisteredNode[]>();
const OVERRIDING_PLUGIN_IDS = new Set(['dynamic']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOverridingPlugin(pluginId: string): boolean {
  return OVERRIDING_PLUGIN_IDS.has(pluginId);
}

function normalizePluginId(value: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error("Plugin manifest is missing required field 'id'");
  }
  return value.trim();
}

function normalizeNodeType(pluginId: string, value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`Plugin '${pluginId}' has a node entry with a missing type`);
  }
  return value.trim();
}

function validateManifest(manifest: PluginManifest): void {
  if (!isNonEmptyString(manifest?.id)) {
    throw new Error("Plugin manifest is missing required field 'id'");
  }
  if (!isNonEmptyString(manifest?.name)) {
    throw new Error("Plugin manifest is missing required field 'name'");
  }
  if (!isNonEmptyString(manifest?.version)) {
    throw new Error("Plugin manifest is missing required field 'version'");
  }
  if (!Array.isArray(manifest?.nodes)) {
    throw new Error("Plugin manifest is missing required field 'nodes'");
  }

  for (const node of manifest.nodes) {
    if (!isNonEmptyString(node?.definitionPath)) {
      throw new Error(`Plugin '${manifest.id}' has a node entry with a missing definitionPath`);
    }
    if (!isNonEmptyString(node?.executorPath)) {
      throw new Error(`Plugin '${manifest.id}' has a node entry with a missing executorPath`);
    }
  }
}

function createDefinitionIndex(
  definitions: readonly NodeDefinition[] | undefined
): Map<string, NodeDefinition> {
  const index = new Map<string, NodeDefinition>();
  for (const definition of definitions ?? []) {
    index.set(definition.id, definition);
  }
  return index;
}

function resolveNodeDefinition(
  manifest: PluginManifest,
  definitionsByType: Map<string, NodeDefinition>,
  nodeType: string,
  entry: NodeEntry
): NodeDefinition {
  const base = entry.definition ?? definitionsByType.get(nodeType);
  if (!base) {
    throw new Error(`Plugin '${manifest.id}' is missing definition for node '${nodeType}'`);
  }

  return {
    ...base,
    id: nodeType,
    component: manifest.components?.[nodeType] ?? base.component,
  };
}

interface StagedHookRegistration {
  hookType: FrontendHookType;
  handler: FrontendHookHandler;
  filterNodeType?: string;
}

function contextMatchesNodeType(
  context: { nodeType?: unknown; sourceNodeType?: unknown; targetNodeType?: unknown },
  nodeType: string
): boolean {
  return (
    context.nodeType === nodeType
    || context.sourceNodeType === nodeType
    || context.targetNodeType === nodeType
  );
}

function filterHookByNodeType<T extends FrontendHookType>(
  handler: FrontendHookHandler<T>,
  nodeType: string
): FrontendHookHandler<T> {
  return ((context: FrontendHookContextMap[T]) => {
    const scopedContext = context as {
      nodeType?: unknown;
      sourceNodeType?: unknown;
      targetNodeType?: unknown;
    };

    if (!contextMatchesNodeType(scopedContext, nodeType)) {
      return undefined as FrontendHookResultMap[T];
    }

    return handler(context);
  }) as FrontendHookHandler<T>;
}

function collectHookRegistrations(
  hooks: FrontendHookHandlers | undefined,
  filterNodeType?: string
): StagedHookRegistration[] {
  if (!hooks) {
    return [];
  }

  const registrations: StagedHookRegistration[] = [];
  const hookTypes = Object.keys(hooks) as FrontendHookType[];

  for (const hookType of hookTypes) {
    const handler = hooks[hookType] as FrontendHookHandler | undefined;
    if (handler === undefined) {
      continue;
    }
    if (typeof handler !== 'function') {
      throw new TypeError(`Hook '${hookType}' must be a function`);
    }

    registrations.push({
      hookType,
      handler,
      filterNodeType,
    });
  }

  return registrations;
}

function registerStagedHooks(pluginId: string, registrations: StagedHookRegistration[]): void {
  for (const registration of registrations) {
    const handler = registration.filterNodeType
      ? filterHookByNodeType(registration.handler, registration.filterNodeType)
      : registration.handler;

    registerHook(pluginId, registration.hookType, handler);
  }
}

function rollbackPluginState(pluginId: string): void {
  for (const [nodeType, stack] of nodesByType.entries()) {
    const remaining = stack.filter((node) => node.pluginId !== pluginId);
    if (remaining.length === 0) {
      nodesByType.delete(nodeType);
    } else {
      nodesByType.set(nodeType, remaining);
    }
  }

  deregisterHooks(pluginId);
  plugins.delete(pluginId);
}

function assertNodeTypeAvailable(nodeType: string, pluginId: string): void {
  const existing = nodesByType.get(nodeType) ?? [];
  if (existing.length > 0 && !isOverridingPlugin(pluginId)) {
    const owner = existing[existing.length - 1]?.pluginId ?? existing[0].pluginId;
    throw new Error(`Node type '${nodeType}' is already registered by plugin '${owner}'`);
  }
}

function pushRegisteredNode(nodeType: string, node: RegisteredNode): void {
  assertNodeTypeAvailable(nodeType, node.pluginId);
  const existing = nodesByType.get(nodeType) ?? [];
  nodesByType.set(nodeType, [...existing, node]);
}

function mergeNodeDefinitions(definitions: readonly NodeDefinition[]): NodeDefinition {
  const [first, ...rest] = definitions;
  if (!first) {
    throw new Error('Cannot merge empty node definition stack');
  }

  return rest.reduce<NodeDefinition>(
    (merged, definition) => ({ ...merged, ...definition }),
    first
  );
}

function topRegisteredNode(nodeType: string): RegisteredNode | undefined {
  const stack = nodesByType.get(nodeType);
  if (!stack || stack.length === 0) {
    return undefined;
  }
  return stack[stack.length - 1];
}

function normalizeStackDefinition(nodeType: string): NodeDefinition | undefined {
  const stack = nodesByType.get(nodeType);
  if (!stack || stack.length === 0) {
    return undefined;
  }

  const merged = mergeNodeDefinitions(stack.map((item) => item.definition));
  return {
    ...merged,
    id: nodeType,
  };
}

export function registerPlugin(manifest: PluginManifest): void {
  validateManifest(manifest);

  const pluginId = normalizePluginId(manifest.id);
  if (plugins.has(pluginId)) {
    throw new Error(`Plugin '${pluginId}' is already registered`);
  }

  const definitionsByType = createDefinitionIndex(manifest.definitions);
  const seenNodeTypes = new Set<string>();
  const stagedNodes: RegisteredNode[] = [];
  const stagedNodeHooks: StagedHookRegistration[] = [];

  for (const entry of manifest.nodes) {
    const nodeType = normalizeNodeType(pluginId, entry.type);
    if (seenNodeTypes.has(nodeType)) {
      throw new Error(`Plugin '${pluginId}' declares duplicate node type '${nodeType}'`);
    }
    seenNodeTypes.add(nodeType);

    assertNodeTypeAvailable(nodeType, pluginId);

    const definition = resolveNodeDefinition(manifest, definitionsByType, nodeType, entry);
    const normalizedEntry: NodeEntry = { ...entry, type: nodeType };

    stagedNodes.push({
      pluginId,
      entry: normalizedEntry,
      definition,
    });

    stagedNodeHooks.push(...collectHookRegistrations(entry.hooks, nodeType));
  }

  const stagedManifestHooks = collectHookRegistrations(manifest.hooks);

  try {
    for (const node of stagedNodes) {
      pushRegisteredNode(node.entry.type, node);
    }

    registerStagedHooks(pluginId, stagedNodeHooks);
    registerStagedHooks(pluginId, stagedManifestHooks);
    plugins.set(pluginId, { nodeTypes: stagedNodes.map((node) => node.entry.type) });
  } catch (error) {
    rollbackPluginState(pluginId);
    throw error;
  }
}

export function unregisterPlugin(pluginId: string): boolean {
  const normalized = pluginId.trim();
  const plugin = plugins.get(normalized);
  if (!plugin) {
    return false;
  }

  for (const nodeType of plugin.nodeTypes) {
    const stack = nodesByType.get(nodeType) ?? [];
    const remaining = stack.filter((node) => node.pluginId !== normalized);
    if (remaining.length === 0) {
      nodesByType.delete(nodeType);
    } else {
      nodesByType.set(nodeType, remaining);
    }
  }

  deregisterHooks(normalized);
  plugins.delete(normalized);
  return true;
}

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return normalizeStackDefinition(type);
}

export function listAllNodeDefinitions(): NodeDefinition[] {
  return listNodeTypes()
    .map((type) => getNodeDefinition(type))
    .filter((definition): definition is NodeDefinition => Boolean(definition));
}

export function listNodeTypes(): string[] {
  return Array.from(nodesByType.keys());
}

export function getNodeDefinitionMetadata(type: string): NodeDefinitionMetadata | undefined {
  const node = topRegisteredNode(type);
  if (!node) {
    return undefined;
  }

  return {
    nodeType: type,
    definitionModule: node.entry.definitionPath,
    runtimeModule: node.entry.executorPath,
  };
}

export function resetPluginRegistryForTests(): void {
  nodesByType.clear();
  plugins.clear();
  resetHooksForTests();
}
