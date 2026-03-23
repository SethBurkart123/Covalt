import type { NodeTypes } from '@xyflow/react';

import { FlowNode as FlowNodeComponent } from './node';
import { RerouteNode } from './reroute-node';

const CUSTOM_NODE_COMPONENTS: Partial<NodeTypes> = {
  reroute: RerouteNode,
};

export function buildNodeTypes(nodeTypeIds: string[]): NodeTypes {
  const types: NodeTypes = {};
  const sortedIds = [...nodeTypeIds].sort((a, b) => a.localeCompare(b));
  for (const id of sortedIds) {
    types[id] = CUSTOM_NODE_COMPONENTS[id] ?? FlowNodeComponent;
  }
  return types;
}
