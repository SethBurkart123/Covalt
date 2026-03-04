import type { NodeTypes } from '@xyflow/react';

import { FlowNode as FlowNodeComponent } from './node';

export function buildNodeTypes(nodeTypeIds: string[]): NodeTypes {
  const types: NodeTypes = {};
  const sortedIds = [...nodeTypeIds].sort((a, b) => a.localeCompare(b));
  for (const id of sortedIds) {
    types[id] = FlowNodeComponent;
  }
  return types;
}
