
import { request } from '@/python/_internal';
import type { NodeDefinition } from '@/lib/flow';
import { registerPlugin, unregisterPlugin } from '@/lib/flow';
import type { PluginManifest } from '@nodes/_manifest';

interface NodeProviderDefinitionsResponse {
  definitions: Array<{
    type: string;
    name: string;
    description?: string;
    category: NodeDefinition['category'];
    icon: string;
    executionMode: NodeDefinition['executionMode'];
    parameters: NodeDefinition['parameters'];
    providerId?: string;
    pluginId?: string;
  }>;
}

const loadedProviderPluginIds = new Set<string>();

function toPluginManifests(definitions: NodeDefinition[]): PluginManifest[] {
  const byPlugin = new Map<string, NodeDefinition[]>();

  for (const definition of definitions) {
    const pluginId = String((definition as { pluginId?: string }).pluginId || '').trim();
    if (!pluginId) {
      continue;
    }

    const entries = byPlugin.get(pluginId) ?? [];
    entries.push(definition);
    byPlugin.set(pluginId, entries);
  }

  return Array.from(byPlugin.entries()).map(([pluginId, pluginDefinitions]) => ({
    id: pluginId,
    name: pluginId,
    version: '1',
    nodes: pluginDefinitions.map((definition) => ({
      type: definition.id,
      definitionPath: '[node-provider]',
      executorPath: '[node-provider-runtime]',
      definition,
    })),
    definitions: pluginDefinitions,
  }));
}

function resetProviderPlugins(nextPluginIds: Set<string>): void {
  const toClear = new Set<string>([
    ...Array.from(loadedProviderPluginIds),
    ...Array.from(nextPluginIds),
  ]);

  for (const pluginId of toClear) {
    unregisterPlugin(pluginId);
  }
}

function recordLoadedProviderPlugins(nextPluginIds: Set<string>): void {
  loadedProviderPluginIds.clear();
  for (const pluginId of nextPluginIds) {
    loadedProviderPluginIds.add(pluginId);
  }
}

export async function refreshNodeProviderDefinitions(): Promise<void> {
  const response = await request<NodeProviderDefinitionsResponse>('list_node_provider_definitions', {});
  const definitions: NodeDefinition[] = (response.definitions || []).map((item) => ({
    id: item.type,
    name: item.name,
    description: item.description,
    category: item.category,
    icon: item.icon,
    executionMode: item.executionMode,
    parameters: item.parameters,
    pluginId: item.pluginId || item.providerId,
  })) as NodeDefinition[];

  const manifests = toPluginManifests(definitions);
  const nextPluginIds = new Set(manifests.map((manifest) => manifest.id));

  resetProviderPlugins(nextPluginIds);

  for (const manifest of manifests) {
    registerPlugin(manifest);
  }

  recordLoadedProviderPlugins(nextPluginIds);
}
