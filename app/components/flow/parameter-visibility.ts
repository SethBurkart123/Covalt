import type { EdgeChannel, FlowEdge, Parameter, ShowWhen } from '@/lib/flow';

export type ParamRenderContext = 'node' | 'inspector';

export interface NodeEdgeIndex {
  incoming: FlowEdge[];
  outgoing: FlowEdge[];
}

export function buildNodeEdgeIndex(edges: FlowEdge[], nodeId: string): NodeEdgeIndex {
  const incoming: FlowEdge[] = [];
  const outgoing: FlowEdge[] = [];

  for (const edge of edges) {
    if (edge.target === nodeId) incoming.push(edge);
    if (edge.source === nodeId) outgoing.push(edge);
  }

  return { incoming, outgoing };
}

export function shouldRenderParam(
  param: Parameter,
  context: ParamRenderContext,
  index: NodeEdgeIndex
): boolean {
  const scope = param.renderScope ?? 'both';
  if (context === 'node' && scope === 'inspector') return false;
  if (context === 'inspector' && scope === 'node') return false;
  return matchesShowWhen(param.showWhen, index);
}

function matchesShowWhen(showWhen: ShowWhen | undefined, index: NodeEdgeIndex): boolean {
  if (!showWhen) return true;

  const conditions: boolean[] = [];

  if (showWhen.connected !== undefined) {
    conditions.push(hasAnyConnection(index, showWhen.connected, showWhen.channel));
  }
  if (showWhen.connectedOut !== undefined) {
    conditions.push(hasOutgoing(index, showWhen.connectedOut, showWhen.channel));
  }
  if (showWhen.connectedFrom !== undefined) {
    conditions.push(hasIncomingFrom(index, showWhen.connectedFrom, showWhen.channel));
  }
  if (showWhen.connectedTo !== undefined) {
    conditions.push(hasOutgoingTo(index, showWhen.connectedTo, showWhen.channel));
  }
  if (showWhen.notConnected !== undefined) {
    conditions.push(!hasAnyConnection(index, showWhen.notConnected, showWhen.channel));
  }
  if (showWhen.notConnectedOut !== undefined) {
    conditions.push(!hasOutgoing(index, showWhen.notConnectedOut, showWhen.channel));
  }
  if (showWhen.notConnectedFrom !== undefined) {
    conditions.push(!hasIncomingFrom(index, showWhen.notConnectedFrom, showWhen.channel));
  }
  if (showWhen.notConnectedTo !== undefined) {
    conditions.push(!hasOutgoingTo(index, showWhen.notConnectedTo, showWhen.channel));
  }

  if (conditions.length === 0) return true;
  return conditions.every(Boolean);
}

function hasIncoming(index: NodeEdgeIndex, handleId: string, channel?: EdgeChannel): boolean {
  return index.incoming.some(edge => {
    if (edge.targetHandle !== handleId) return false;
    return matchesChannel(edge, channel);
  });
}

function hasOutgoing(index: NodeEdgeIndex, handleId: string, channel?: EdgeChannel): boolean {
  return index.outgoing.some(edge => {
    if (edge.sourceHandle !== handleId) return false;
    return matchesChannel(edge, channel);
  });
}

function hasAnyConnection(index: NodeEdgeIndex, handleId: string, channel?: EdgeChannel): boolean {
  return (
    index.incoming.some(edge => edge.targetHandle === handleId && matchesChannel(edge, channel)) ||
    index.outgoing.some(edge => edge.sourceHandle === handleId && matchesChannel(edge, channel))
  );
}

function hasIncomingFrom(index: NodeEdgeIndex, handleId: string, channel?: EdgeChannel): boolean {
  return index.incoming.some(edge => {
    if (edge.sourceHandle !== handleId) return false;
    return matchesChannel(edge, channel);
  });
}

function hasOutgoingTo(index: NodeEdgeIndex, handleId: string, channel?: EdgeChannel): boolean {
  return index.outgoing.some(edge => {
    if (edge.targetHandle !== handleId) return false;
    return matchesChannel(edge, channel);
  });
}

function matchesChannel(edge: FlowEdge, channel?: EdgeChannel): boolean {
  if (!channel) return true;
  return edge.data.channel === channel;
}
