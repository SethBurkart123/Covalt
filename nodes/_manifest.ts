import type {
  FrontendHookHandlers,
  NodeDefinition,
} from './_types';

export interface NodeEntry {
  type: string;
  definitionPath: string;
  executorPath: string;
  hooks?: FrontendHookHandlers;
  definition?: NodeDefinition;
}

export type PluginComponentRegistry = Readonly<Record<string, unknown>>;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  nodes: readonly NodeEntry[];
  hooks?: FrontendHookHandlers;
  components?: PluginComponentRegistry;
  definitions?: readonly NodeDefinition[];
}

