import packageJson from '../package.json';

import type { NodeDefinition } from './_types';
import type { NodeEntry, PluginManifest } from './_manifest';

import { chatStart } from './core/chat_start/definition';
import { webhookTrigger } from './core/webhook_trigger/definition';
import { webhookEnd } from './core/webhook_end/definition';
import { agent } from './core/agent/definition';
import { droidAgent } from './core/droid_agent/definition';
import { mcpServer } from './tools/mcp_server/definition';
import { toolset } from './tools/toolset/definition';
import { llmCompletion } from './ai/llm_completion/definition';
import { promptTemplate } from './ai/prompt_template/definition';
import { conditional } from './flow/conditional/definition';
import { merge } from './flow/merge/definition';
import { reroute } from './flow/reroute/definition';
import { code } from './data/code/definition';
import { modelSelector } from './utility/model_selector/definition';

function createHookId(): string {
  return `hook_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRerouteSocketType(context: {
  data?: Record<string, unknown>;
  currentType?: string;
}): string | undefined {
  const raw = context.data?._socketType;
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return context.currentType;
}

const BUILTIN_NODE_ENTRIES: readonly NodeEntry[] = [
  {
    type: 'chat-start',
    definitionPath: 'nodes/core/chat_start/definition.ts',
    executorPath: 'nodes/core/chat_start/executor.py',
  },
  {
    type: 'webhook-trigger',
    definitionPath: 'nodes/core/webhook_trigger/definition.ts',
    executorPath: 'nodes/core/webhook_trigger/executor.py',
    hooks: {
      onNodeCreate: (context) => {
        const existing = context.initialData.hookId;
        if (typeof existing === 'string' && existing.trim()) {
          return undefined;
        }
        return { hookId: createHookId() };
      },
    },
  },
  {
    type: 'webhook-end',
    definitionPath: 'nodes/core/webhook_end/definition.ts',
    executorPath: 'nodes/core/webhook_end/executor.py',
  },
  {
    type: 'agent',
    definitionPath: 'nodes/core/agent/definition.ts',
    executorPath: 'nodes/core/agent/executor.py',
  },
  {
    type: 'droid-agent',
    definitionPath: 'nodes/core/droid_agent/definition.ts',
    executorPath: 'nodes/core/droid_agent/executor.py',
  },
  {
    type: 'llm-completion',
    definitionPath: 'nodes/ai/llm_completion/definition.ts',
    executorPath: 'nodes/ai/llm_completion/executor.py',
  },
  {
    type: 'prompt-template',
    definitionPath: 'nodes/ai/prompt_template/definition.ts',
    executorPath: 'nodes/ai/prompt_template/executor.py',
  },
  {
    type: 'conditional',
    definitionPath: 'nodes/flow/conditional/definition.ts',
    executorPath: 'nodes/flow/conditional/executor.py',
  },
  {
    type: 'merge',
    definitionPath: 'nodes/flow/merge/definition.ts',
    executorPath: 'nodes/flow/merge/executor.py',
  },
  {
    type: 'reroute',
    definitionPath: 'nodes/flow/reroute/definition.ts',
    executorPath: 'nodes/flow/reroute/executor.py',
    hooks: {
      onSocketTypePropagate: resolveRerouteSocketType,
    },
  },
  {
    type: 'mcp-server',
    definitionPath: 'nodes/tools/mcp_server/definition.ts',
    executorPath: 'nodes/tools/mcp_server/executor.py',
  },
  {
    type: 'toolset',
    definitionPath: 'nodes/tools/toolset/definition.ts',
    executorPath: 'nodes/tools/toolset/executor.py',
  },
  {
    type: 'code',
    definitionPath: 'nodes/data/code/definition.ts',
    executorPath: 'nodes/data/code/executor.py',
  },
  {
    type: 'model-selector',
    definitionPath: 'nodes/utility/model_selector/definition.ts',
    executorPath: 'nodes/utility/model_selector/executor.py',
  },
];

const BUILTIN_DEFINITIONS: readonly NodeDefinition[] = [
  chatStart,
  webhookTrigger,
  webhookEnd,
  agent,
  droidAgent,
  llmCompletion,
  promptTemplate,
  conditional,
  merge,
  reroute,
  mcpServer,
  toolset,
  code,
  modelSelector,
];

export const builtinPluginManifest: PluginManifest = {
  id: 'builtin',
  name: 'Built-in Nodes',
  version: packageJson.version,
  nodes: BUILTIN_NODE_ENTRIES,
  definitions: BUILTIN_DEFINITIONS,
};
