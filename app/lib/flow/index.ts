/**
 * Flow System - Public API
 * Parameter-driven node system for the agent graph editor.
 */


export type {
  SocketShape,
  SocketTypeId,
  ParameterType,
  ParameterMode,
  SocketConfig,
  Parameter,
  ParameterBase,
  FloatParameter,
  IntParameter,
  StringParameter,
  BooleanParameter,
  EnumParameter,
  TextAreaParameter,
  ModelParameter,
  McpServerParameter,
  ToolsetParameter,
  AgentParameter,
  ToolsParameter,
  ColorParameter,
  JsonParameter,
  NodeCategory,
  NodeDefinition,
  FlowNode,
  FlowEdge,
  FlowGraph,
} from '@nodes/_types';

export { SOCKET_TYPES, canConnect, getSocketStyle } from './sockets';
export type { SocketType } from './sockets';

export {
  NODE_DEFINITIONS,
  getNodeDefinition,
  listNodeTypes,
  getNodesByCategory,
  getCompatibleNodeSockets,
  createFlowNode,
  chatStart,
  agent,
  mcpServer,
  toolset,
} from '@nodes/_registry';
export type { CompatibleNodeSocket } from '@nodes/_registry';

export { FlowProvider, useFlow, useFlowState, useFlowActions, useSelection } from './context';
