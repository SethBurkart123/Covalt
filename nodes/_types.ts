/**
 * Core type definitions for the parameter-driven node system.
 * NO React imports here - this is pure data.
 */

/** Socket type identifier - must match keys in SOCKET_TYPES */
export type SocketTypeId =
  | 'data'
  | 'tools'
  | 'float' | 'int' | 'string' | 'boolean'
  | 'json' | 'model';

export type SocketShape = 'circle' | 'square' | 'diamond';

export type EdgeChannel = 'flow' | 'link';

/** Parameter types that the UI layer understands */
export type ParameterType =
  | 'data'
  | 'float'
  | 'int'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'text-area'
  | 'code'
  | 'messages'
  | 'model'
  | 'mcp-server'
  | 'toolset'
  | 'tools'
  | 'node-ref'
  | 'json'
  | 'collection';

/** How the parameter behaves */
export type ParameterMode =
  | 'constant'  // Always a control, never connectable
  | 'hybrid'    // Control by default, socket on left when connected hides control
  | 'input'     // Pure input socket (left side)
  | 'output';   // Pure output socket (right side)

/** Where this parameter is rendered */
type ParameterRenderScope = 'node' | 'inspector' | 'both';

/** Socket visual configuration */
export interface SocketConfig {
  type: SocketTypeId;
  side?: 'left' | 'right';  // Override default positioning (derived from mode if omitted)
  bidirectional?: boolean;  // Can be both source and target (for hub topology)
  channel?: EdgeChannel;    // Optional explicit routing channel (flow/link)
  color?: string;           // Override default color
  shape?: SocketShape;  // Override default shape
}

interface AutoExpandConfig {
  min?: number;
  max?: number;
}

/** Conditional visibility — show this parameter only when a condition is met */
export interface ShowWhen {
  /** Show only when this parameter's socket has a connection */
  connected?: string;
  /** Show only when this node has an outgoing connection from this handle */
  connectedOut?: string;
  /** Show only when this node has an incoming connection from a handle */
  connectedFrom?: string;
  /** Show only when this node has an outgoing connection to a target handle */
  connectedTo?: string;
  /** Show only when this parameter's socket has no connection */
  notConnected?: string;
  /** Show only when this node has no outgoing connection from this handle */
  notConnectedOut?: string;
  /** Show only when this node has no incoming connection from a handle */
  notConnectedFrom?: string;
  /** Show only when this node has no outgoing connection to a target handle */
  notConnectedTo?: string;
  /** Optional channel filter for the connection checks */
  channel?: EdgeChannel;

  /** Show when another parameter equals a specific value */
  valueEquals?: readonly { paramId: string; value: unknown }[];
  /** Show when another parameter is one of values */
  valueIn?: readonly { paramId: string; values: readonly unknown[] }[];
  /** Show when another parameter does not equal a specific value */
  valueNotEquals?: readonly { paramId: string; value: unknown }[];
  /** Show when another parameter is not in values */
  valueNotIn?: readonly { paramId: string; values: readonly unknown[] }[];
  /** Show when another parameter exists */
  exists?: readonly string[];
  /** Show when another parameter does not exist */
  notExists?: readonly string[];
}

/** Base parameter definition */
interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
  mode: ParameterMode;

  /** Control where this parameter is rendered */
  renderScope?: ParameterRenderScope;

  /** Layout hint for inspector panels */
  panelLayout?: 'default' | 'full';
  
  /** For input/hybrid/output modes - socket configuration */
  socket?: SocketConfig;
  
  /** Allow multiple connections (for inputs) */
  multiple?: boolean;
  
  /** Max connections from this socket (for outputs). Omit = unlimited */
  maxConnections?: number;
  
  /** When maxConnections exceeded: 'reject' silently, or 'replace' existing */
  onExceedMax?: 'reject' | 'replace';
  
  /** Socket types this input accepts. Omit = same type only */
  acceptsTypes?: readonly SocketTypeId[];

  /** Auto-expand socket inputs (e.g. input_2, input_3) */
  autoExpand?: AutoExpandConfig;
  
  /** Conditional visibility — only render when condition is met */
  showWhen?: ShowWhen;
}

/** Float parameter */
export interface FloatParameter extends ParameterBase {
  type: 'float';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

/** Integer parameter */
export interface IntParameter extends ParameterBase {
  type: 'int';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

/** String parameter */
export interface StringParameter extends ParameterBase {
  type: 'string';
  default?: string;
  placeholder?: string;
}

/** Boolean parameter */
export interface BooleanParameter extends ParameterBase {
  type: 'boolean';
  default?: boolean;
}

/** Enum parameter */
export interface EnumParameter extends ParameterBase {
  type: 'enum';
  values: readonly string[];
  default?: string;
}

/** Text area parameter */
export interface TextAreaParameter extends ParameterBase {
  type: 'text-area';
  default?: string;
  placeholder?: string;
  rows?: number;
}

/** Code editor parameter */
export interface CodeParameter extends ParameterBase {
  type: 'code';
  default?: string;
  placeholder?: string;
  rows?: number;
  language?: 'javascript' | 'typescript';
}

/** Messages parameter */
export interface MessagesParameter extends ParameterBase {
  type: 'messages';
  default?: unknown;
}

/** Model picker parameter */
export interface ModelParameter extends ParameterBase {
  type: 'model';
}

/** MCP server picker parameter */
export interface McpServerParameter extends ParameterBase {
  type: 'mcp-server';
}

/** Toolset picker parameter */
export interface ToolsetParameter extends ParameterBase {
  type: 'toolset';
}

/** Node reference parameter */
export interface NodeRefParameter extends ParameterBase {
  type: 'node-ref';
  /** Restrict selectable node types (e.g. ['agent']) */
  nodeTypes?: readonly string[];
  /** Optional placeholder for the picker */
  placeholder?: string;
  /** Allow selecting the current node */
  allowSelf?: boolean;
}

/** Tools socket parameter */
export interface ToolsParameter extends ParameterBase {
  type: 'tools';
  socket: SocketConfig;
}

/** JSON parameter */
export interface JsonParameter extends ParameterBase {
  type: 'json';
  default?: unknown;
}

/** Data spine parameter — generic JSON flow */
export interface DataParameter extends ParameterBase {
  type: 'data';
}


/** Collection parameter */
export interface CollectionParameter extends ParameterBase {
  type: 'collection';
  repeatable?: boolean;
  minItems?: number;
  maxItems?: number;
  fields: readonly Parameter[];
  default?: unknown;
}

/** Union of all parameter types */
export type Parameter =
  | FloatParameter
  | IntParameter
  | StringParameter
  | BooleanParameter
  | EnumParameter
  | TextAreaParameter
  | CodeParameter
  | MessagesParameter
  | ModelParameter
  | McpServerParameter
  | ToolsetParameter
  | NodeRefParameter
  | ToolsParameter
  | JsonParameter
  | DataParameter
  | CollectionParameter;

/** Node category for palette organization */
export type NodeCategory =
  | 'trigger'
  | 'llm'
  | 'tools'
  | 'flow'
  | 'data'
  | 'integration'
  | 'rag'
  | 'utility';

/**
 * How a node participates in graph execution.
 *
 * - `structural`: Build-time only. Has build(), no execute(). (MCP Server, Toolset)
 * - `flow`:       Runtime only. Has execute(), no build(). (LLM Completion, Conditional)
 * - `hybrid`:     Both phases. Has build() AND execute(). (Agent, Chat Start)
 */
export type ExecutionMode = 'structural' | 'flow' | 'hybrid';

export type FrontendHookType =
  | 'onNodeCreate'
  | 'onConnectionValidate'
  | 'onSocketTypePropagate';

export interface OnNodeCreateContext {
  nodeType: string;
  initialData: Record<string, unknown>;
  nodeId?: string;
  position?: { x: number; y: number };
  definition?: NodeDefinition;
  [key: string]: unknown;
}

export interface OnConnectionValidateContext {
  nodeType?: string;
  sourceNodeType?: string;
  targetNodeType?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  sourceType?: SocketTypeId;
  targetType?: SocketTypeId;
  channel?: EdgeChannel;
  [key: string]: unknown;
}

export interface OnSocketTypePropagateContext {
  nodeType: string;
  nodeId?: string;
  handleId?: string | null;
  currentType?: SocketTypeId;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FrontendHookContextMap {
  onNodeCreate: OnNodeCreateContext;
  onConnectionValidate: OnConnectionValidateContext;
  onSocketTypePropagate: OnSocketTypePropagateContext;
}

export interface FrontendHookResultMap {
  onNodeCreate: Record<string, unknown> | undefined | null;
  onConnectionValidate: boolean | undefined | null;
  onSocketTypePropagate: SocketTypeId | string | undefined | null;
}

export type FrontendHookHandler<T extends FrontendHookType = FrontendHookType> = (
  context: FrontendHookContextMap[T]
) => FrontendHookResultMap[T];

export type FrontendHookHandlers = Partial<{
  [K in FrontendHookType]: FrontendHookHandler<K>;
}>;

interface RouteMetadata {
  idField: string;
  path: string;
  label?: string;
  idPrefix?: string;
  emptyValuePlaceholder?: string;
}

interface SocketTypePropagationMetadata {
  stateField?: string;
  inputHandle?: string;
  outputHandle?: string;
  supportsEdgeInsertion?: boolean;
}

export interface NodeDefinitionMetadata {
  route?: RouteMetadata;
  socketTypePropagation?: SocketTypePropagationMetadata;
}

/** Complete node definition */
export interface NodeDefinition {
  id: string;
  name: string;
  description?: string;
  category: NodeCategory;
  icon: string;  // Lucide icon name
  executionMode: ExecutionMode;
  parameters: readonly Parameter[];
  metadata?: NodeDefinitionMetadata;
  component?: unknown;
}

/** Runtime node instance (what React Flow sees) */
export interface FlowNode {
  id: string;
  type: string;  // NodeDefinition.id
  position: { x: number; y: number };
  data: Record<string, unknown>;
  /** User-facing display name. Defaults to NodeDefinition.name. Used by $() expressions. */
  label?: string;
}

/** Edge between nodes */
export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type?: string;
  data: {
    sourceType?: string;
    targetType?: string;
    channel: EdgeChannel;
  };
}

