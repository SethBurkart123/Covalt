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

export type RendererRole = 'tool' | 'approval' | 'message';

export interface RendererDefinition {
  key: string;
  aliases?: string[];
  toolNamePatterns?: (string | RegExp)[];
  configSchema?: Record<string, 'string' | 'bool' | 'port' | 'any'>;
  // Lazy loaders must resolve to in-tree module specifiers; npm-distributed plugins are not supported yet.
  tool?: () => Promise<{ default: unknown }>;
  approval?: () => Promise<{ default: unknown }>;
  message?: () => Promise<{ default: unknown }>;
}

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
  renderers?: RendererDefinition[];
}

