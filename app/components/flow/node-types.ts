import type { NodeTypes } from '@xyflow/react';

import { FlowNode as FlowNodeComponent } from './node';

export function buildNodeTypes(nodeTypeIds: string[]): NodeTypes {
  const types: NodeTypes = {};
  for (const id of nodeTypeIds) {
    types[id] = FlowNodeComponent;
  }
  return types;
}
