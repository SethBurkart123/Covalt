
import { request } from '@/python/_internal';
import type { NodeDefinition } from '@/lib/flow';
import { setDynamicNodeDefinitions } from '@/lib/flow';

interface NodeProviderDefinitionsResponse {
  definitions: Array<{
    type: string;
    name: string;
    description?: string;
    category: NodeDefinition['category'];
    icon: string;
    executionMode: NodeDefinition['executionMode'];
    parameters: NodeDefinition['parameters'];
  }>;
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
  }));
  setDynamicNodeDefinitions(definitions);
}
