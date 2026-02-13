'use client';

import { useMemo } from 'react';
import type { FlowEdge, FlowNode } from '@/lib/flow';
import { useFlowState } from '@/lib/flow';
import { useAgentTestChat } from '@/contexts/agent-test-chat-context';
import type { FlowNodeExecutionSnapshot } from '@/contexts/agent-test-chat-context';
import {
  buildInputExpression,
  buildNodeExpression,
  buildTriggerExpression,
  collectObjectRows,
  formatPreview,
  getNodeName,
  pickPrimaryOutput,
  valueType,
} from '../flow-data-utils';
import type { TemplateVariableOption } from './types';

interface BuildTemplateVariableOptionsArgs {
  nodeId: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  lastExecutionByNode: Record<string, FlowNodeExecutionSnapshot>;
}

export function useTemplateVariableOptions(nodeId: string | null): TemplateVariableOption[] {
  const { nodes, edges } = useFlowState();
  const { lastExecutionByNode } = useAgentTestChat();

  return useMemo(
    () => buildTemplateVariableOptions({ nodeId, nodes, edges, lastExecutionByNode }),
    [nodeId, nodes, edges, lastExecutionByNode]
  );
}

function buildTemplateVariableOptions({
  nodeId,
  nodes,
  edges,
  lastExecutionByNode,
}: BuildTemplateVariableOptionsArgs): TemplateVariableOption[] {
  if (!nodeId) return [];

  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const flowEdges = edges.filter(edge => edge.data.channel === 'flow');

  const upstreamIds = getUpstreamNodeIds(nodeId, flowEdges);

  const options: TemplateVariableOption[] = [];

  const triggerSource = getTriggerSource(nodesById, upstreamIds);
  const triggerSnapshot = triggerSource ? lastExecutionByNode[triggerSource.id] : undefined;
  const triggerOutput = pickPrimaryOutput(triggerSnapshot);
  const triggerValue = triggerOutput.value ?? buildTriggerFallback();
  options.push(...buildOptionsForValue({
    group: 'Trigger',
    labelPrefix: 'trigger',
    exprForPath: buildTriggerExpression,
    value: triggerValue,
  }));

  const directInputSource = getDirectInputSource(nodeId, nodesById, flowEdges);
  const inputSnapshot = directInputSource ? lastExecutionByNode[directInputSource.id] : undefined;
  const inputOutput = pickPrimaryOutput(inputSnapshot);
  options.push(...buildOptionsForValue({
    group: 'Input',
    labelPrefix: 'input',
    exprForPath: buildInputExpression,
    value: inputOutput.value,
  }));

  for (const upstreamId of upstreamIds) {
    const node = nodesById.get(upstreamId);
    if (!node) continue;

    const snapshot = lastExecutionByNode[upstreamId];
    const output = pickPrimaryOutput(snapshot);
    const nodeName = getNodeName(node);

    options.push(...buildOptionsForValue({
      group: nodeName,
      labelPrefix: nodeName,
      exprForPath: path => buildNodeExpression(nodeName, path),
      value: output.value,
    }));
  }

  return dedupeOptions(options);
}

function getTriggerSource(
  nodesById: Map<string, FlowNode>,
  upstreamIds: string[]
): FlowNode | null {
  for (const nodeId of upstreamIds) {
    const node = nodesById.get(nodeId);
    if (node?.type === 'chat-start') return node;
  }

  for (const node of nodesById.values()) {
    if (node.type === 'chat-start') return node;
  }

  return null;
}

function buildTriggerFallback(): Record<string, unknown> {
  return {
    message: '',
    last_user_message: '',
    history: [],
    messages: [],
    attachments: [],
  };
}

function getUpstreamNodeIds(nodeId: string, edges: FlowEdge[]): string[] {
  const seen = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    for (const edge of edges) {
      if (edge.target !== current || !edge.source) continue;
      if (seen.has(edge.source)) continue;
      seen.add(edge.source);
      queue.push(edge.source);
    }
  }

  return Array.from(seen.values());
}

function getDirectInputSource(
  nodeId: string,
  nodesById: Map<string, FlowNode>,
  edges: FlowEdge[]
): FlowNode | null {
  const inputEdge = edges.find(
    edge => edge.target === nodeId && (edge.targetHandle ?? 'input') === 'input'
  );
  if (!inputEdge?.source) return null;
  return nodesById.get(inputEdge.source) ?? null;
}

function buildOptionsForValue({
  group,
  labelPrefix,
  exprForPath,
  value,
}: {
  group: string;
  labelPrefix?: string;
  exprForPath: (path: string) => string;
  value: unknown;
}): TemplateVariableOption[] {
  const labelRoot = labelPrefix ?? group;
  if (value === undefined) {
    return [
      {
        expr: stripTemplateBraces(exprForPath('')),
        label: labelRoot,
        preview: undefined,
        group,
        type: 'unknown',
        hasData: false,
      },
    ];
  }

  const rows = collectObjectRows(value);
  const options: TemplateVariableOption[] = [];

  const hasRoot = rows.some(row => row.path === '');
  if (!hasRoot) {
    options.push({
      expr: stripTemplateBraces(exprForPath('')),
      label: labelRoot,
      preview: formatPreview(value),
      group,
      type: valueType(value),
      hasData: true,
    });
  }

  for (const row of rows) {
    options.push({
      expr: stripTemplateBraces(exprForPath(row.path)),
      label: row.path ? `${labelRoot} -> ${row.path}` : labelRoot,
      preview: formatPreview(row.value),
      group,
      type: row.type,
      hasData: true,
    });
  }

  return options;
}

function stripTemplateBraces(expression: string): string {
  const trimmed = expression.trim();
  const match = trimmed.match(/^{{\s*([\s\S]+?)\s*}}$/);
  return match?.[1]?.trim() ?? trimmed;
}

function dedupeOptions(options: TemplateVariableOption[]): TemplateVariableOption[] {
  const seen = new Set<string>();
  const deduped: TemplateVariableOption[] = [];

  for (const option of options) {
    if (!seen.has(option.expr)) {
      seen.add(option.expr);
      deduped.push(option);
      continue;
    }

    const existingIndex = deduped.findIndex(item => item.expr === option.expr);
    if (existingIndex === -1) continue;
    const existing = deduped[existingIndex];
    const existingHasData = existing.hasData ?? true;
    const nextHasData = option.hasData ?? true;
    if (!existingHasData && nextHasData) {
      deduped[existingIndex] = option;
    }
  }

  return deduped;
}
