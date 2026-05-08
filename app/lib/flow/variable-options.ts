import {
  variableLinkHandle,
  type OptionsSource,
  type VariableOption,
  type VariableSpec,
} from '@nodes/_variables';
import {
  resolveVariableOptionsCallback,
  resolveVariableOptionsLink,
} from '@/python/api';

export interface ResolveOptionsContext {
  graphData?: { nodes: unknown[]; edges: unknown[] };
  chatStartNodeId?: string | null;
}

export async function resolveVariableOptions(
  spec: VariableSpec,
  context: ResolveOptionsContext
): Promise<VariableOption[]> {
  const source = spec.options;
  if (!source) return [];

  if (source.kind === 'static') {
    return source.options.slice();
  }

  if (source.kind === 'callback') {
    return resolveCallbackOptions(source);
  }

  if (source.kind === 'link') {
    return resolveLinkOptions(spec, source, context);
  }

  return [];
}

async function resolveCallbackOptions(
  source: Extract<OptionsSource, { kind: 'callback' }>
): Promise<VariableOption[]> {
  if (!source.load) return [];
  try {
    const result = await resolveVariableOptionsCallback({
      body: { load: source.load, params: source.params ?? {} },
    });
    return result.options.map(toVariableOption);
  } catch (error) {
    console.error('resolveCallbackOptions failed', error);
    return [];
  }
}

async function resolveLinkOptions(
  spec: VariableSpec,
  _source: Extract<OptionsSource, { kind: 'link' }>,
  context: ResolveOptionsContext
): Promise<VariableOption[]> {
  if (!context.graphData || !context.chatStartNodeId) return [];
  try {
    const result = await resolveVariableOptionsLink({
      body: {
        graphData: context.graphData as { nodes: unknown[]; edges: unknown[] },
        nodeId: context.chatStartNodeId,
        handle: variableLinkHandle(spec.id),
      },
    });
    return result.options.map(toVariableOption);
  } catch (error) {
    console.error('resolveLinkOptions failed', error);
    return [];
  }
}

function toVariableOption(raw: { value: unknown; label: string; group?: string | null; icon?: string | null }): VariableOption {
  return {
    value: raw.value,
    label: raw.label,
    ...(raw.group ? { group: raw.group } : {}),
    ...(raw.icon ? { icon: raw.icon } : {}),
  };
}
