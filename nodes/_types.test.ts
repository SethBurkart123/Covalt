import { describe, expect, it } from 'vitest';
import type {
  EdgeChannel,
  ExecutionMode,
  FrontendHookType,
  NodeCategory,
  NodeDefinition,
  ParameterMode,
  SocketTypeId,
} from './_types';

describe('nodes/_types contracts', () => {
  it('supports canonical discriminated unions used by flow definitions', () => {
    const executionModes: ExecutionMode[] = ['structural', 'flow', 'hybrid'];
    const categories: NodeCategory[] = ['trigger', 'llm', 'tools', 'flow', 'data', 'integration', 'rag', 'utility'];
    const parameterModes: ParameterMode[] = ['constant', 'hybrid', 'input', 'output'];
    const socketTypes: SocketTypeId[] = ['data', 'tools', 'float', 'int', 'string', 'boolean', 'json', 'model'];
    const channels: EdgeChannel[] = ['flow', 'link'];
    const hookTypes: FrontendHookType[] = ['onNodeCreate', 'onConnectionValidate', 'onSocketTypePropagate'];

    expect(executionModes).toHaveLength(3);
    expect(categories).toContain('flow');
    expect(parameterModes).toContain('hybrid');
    expect(socketTypes).toContain('tools');
    expect(channels).toContain('flow');
    expect(hookTypes).toContain('onSocketTypePropagate');
  });

  it('keeps node definition metadata shape compatible with route and socket metadata', () => {
    const definition: NodeDefinition = {
      id: 'test-node',
      name: 'Test Node',
      category: 'utility',
      icon: 'Wrench',
      executionMode: 'flow',
      parameters: [],
      metadata: {
        route: {
          idField: 'nodeId',
          path: '/agents/edit',
          label: 'Agent',
          idPrefix: 'node_',
          emptyValuePlaceholder: 'none',
        },
        socketTypePropagation: {
          stateField: 'data.socketType',
          inputHandle: 'input',
          outputHandle: 'output',
          supportsEdgeInsertion: true,
        },
      },
    };

    expect(definition.metadata?.route?.path).toBe('/agents/edit');
    expect(definition.metadata?.socketTypePropagation?.supportsEdgeInsertion).toBe(true);
  });
});
