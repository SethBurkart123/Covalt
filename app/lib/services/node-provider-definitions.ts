
import { listNodeProviderDefinitions } from '@/python/api';
import type { NodeDefinition } from '@/lib/flow';
import { registerPlugin, unregisterPlugin } from '@/lib/flow';
import type { PluginManifest } from '@nodes/_manifest';

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
  const response = await listNodeProviderDefinitions();
  const definitions: NodeDefinition[] = (response.definitions || []).map((item) => ({
    id: item.type,
    name: item.name,
    description: item.description,
    category: item.category as NodeDefinition['category'],
    icon: item.icon,
    executionMode: item.executionMode as NodeDefinition['executionMode'],
    parameters: item.parameters as NodeDefinition['parameters'],
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
