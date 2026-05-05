import type {
  FrontendHookHandlers,
  NodeDefinition,
  SocketShape,
} from './_types';

export interface SocketTypeDeclaration {
  id: string;
  color: string;
  shape: SocketShape;
}

export interface CoercionDeclaration {
  from: string;
  to: string;
}

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
  socketTypes?: readonly SocketTypeDeclaration[];
  coercions?: readonly CoercionDeclaration[];
}

