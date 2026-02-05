/**
 * Core type definitions for the parameter-driven node system.
 * NO React imports here - this is pure data.
 */

/** Socket type identifier - must match keys in SOCKET_TYPES */
export type SocketTypeId = 'agent' | 'tools' | 'float' | 'int' | 'string' | 'boolean' | 'color';

/** Parameter types that the UI layer understands */
export type ParameterType =
  | 'float'
  | 'int'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'text-area'
  | 'model'
  | 'mcp-server'
  | 'toolset'
  | 'agent'
  | 'tools'
  | 'color'
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
  color?: string;           // Override default color
  shape?: 'circle' | 'square' | 'diamond';  // Override default shape
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

/** Agent socket parameter */
export interface AgentParameter extends ParameterBase {
  type: 'agent';
  socket: SocketConfig;
}

/** Tools socket parameter */
export interface ToolsParameter extends ParameterBase {
  type: 'tools';
  socket: SocketConfig;
}

/** Color parameter */
export interface ColorParameter extends ParameterBase {
  type: 'color';
  default?: string;
}

/** JSON parameter */
export interface JsonParameter extends ParameterBase {
  type: 'json';
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
  | ModelParameter
  | McpServerParameter
  | ToolsetParameter
  | AgentParameter
  | ToolsParameter
  | ColorParameter
  | JsonParameter;

/** Node category for palette organization */
export type NodeCategory = 'core' | 'tools' | 'data' | 'utility';

/** Complete node definition */
export interface NodeDefinition {
  id: string;
  name: string;
  description?: string;
  category: NodeCategory;
  icon: string;  // Lucide icon name
  parameters: readonly Parameter[];
}

/** Runtime node instance (what React Flow sees) */
export interface FlowNode {
  id: string;
  type: string;  // NodeDefinition.id
  position: { x: number; y: number };
  data: Record<string, unknown>;
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
  };
}

/** Complete graph state */
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
