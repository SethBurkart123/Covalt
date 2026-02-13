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
  | 'messages'
  | 'model'
  | 'mcp-server'
  | 'toolset'
  | 'tools'
  | 'json';

/** How the parameter behaves */
export type ParameterMode =
  | 'constant'  // Always a control, never connectable
  | 'hybrid'    // Control by default, socket on left when connected hides control
  | 'input'     // Pure input socket (left side)
  | 'output';   // Pure output socket (right side)

/** Socket visual configuration */
export interface SocketConfig {
  type: SocketTypeId;
  side?: 'left' | 'right';  // Override default positioning (derived from mode if omitted)
  bidirectional?: boolean;  // Can be both source and target (for hub topology)
  channel?: EdgeChannel;    // Optional explicit routing channel (flow/link)
  color?: string;           // Override default color
  shape?: SocketShape;  // Override default shape
}

/** Conditional visibility — show this parameter only when a condition is met */
export interface ShowWhen {
  /** Show only when this parameter's socket has a connection */
  connected: string;
}

/** Base parameter definition */
export interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
  mode: ParameterMode;
  
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

/** Union of all parameter types */
export type Parameter =
  | FloatParameter
  | IntParameter
  | StringParameter
  | BooleanParameter
  | EnumParameter
  | TextAreaParameter
  | MessagesParameter
  | ModelParameter
  | McpServerParameter
  | ToolsetParameter
  | ToolsParameter
  | JsonParameter
  | DataParameter;

/** Node category for palette organization */
export type NodeCategory = 'core' | 'tools' | 'ai' | 'flow' | 'data' | 'integration' | 'rag' | 'utility';

/**
 * How a node participates in graph execution.
 *
 * - `structural`: Build-time only. Has build(), no execute(). (MCP Server, Toolset)
 * - `flow`:       Runtime only. Has execute(), no build(). (LLM Completion, Conditional)
 * - `hybrid`:     Both phases. Has build() AND execute(). (Agent, Chat Start)
 */
export type ExecutionMode = 'structural' | 'flow' | 'hybrid';

/** Complete node definition */
export interface NodeDefinition {
  id: string;
  name: string;
  description?: string;
  category: NodeCategory;
  icon: string;  // Lucide icon name
  executionMode: ExecutionMode;
  parameters: readonly Parameter[];
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
  data?: {
    sourceType?: string;
    targetType?: string;
    channel?: EdgeChannel;
  };
}

/** Complete graph state */
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
