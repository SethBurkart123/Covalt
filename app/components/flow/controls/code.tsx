'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type { Parameter } from '@/lib/flow';
import { useFlowState } from '@/lib/flow';
import { useFlowExecution } from '@/contexts/flow-execution-context';
import { filterFlowEdges, upstreamClosure } from '@/lib/flow/graph-traversal';
import { getNodeDefinition } from '@/lib/flow';
import { getNodeName, pickPrimaryOutput } from '../flow-data-utils';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import { cn } from '@/lib/utils';

interface CodeControlProps {
  param: Parameter;
  value: string | undefined;
  onChange: (value: string) => void;
  compact?: boolean;
  nodeId?: string | null;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_DEPTH = 6;

function sanitizeTypeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  const safe = cleaned || 'Node';
  return IDENTIFIER_PATTERN.test(safe) ? safe : `Node_${safe}`;
}

function formatObjectKey(key: string): string {
  if (IDENTIFIER_PATTERN.test(key)) return key;
  return JSON.stringify(key);
}

function inferTsType(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return 'any';
  if (value === null) return 'null';
  if (value === undefined) return 'any';

  if (Array.isArray(value)) {
    if (value.length === 0) return 'any[]';
    const sample = value.find(item => item !== undefined) ?? value[0];
    return `${inferTsType(sample, depth + 1)}[]`;
  }

  const valueType = typeof value;
  if (valueType === 'string') return 'string';
  if (valueType === 'number') return 'number';
  if (valueType === 'boolean') return 'boolean';

  if (valueType === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return 'Record<string, unknown>';

    const props = entries
      .map(([key, nested]) => `${formatObjectKey(key)}?: ${inferTsType(nested, depth + 1)}`)
      .join('; ');
    return `{ ${props} }`;
  }

  return 'any';
}

function buildTriggerFallback(): Record<string, unknown> {
  return {
    message: '',
    last_user_message: '',
    history: [],
    messages: [],
    attachments: [],
    body: {},
    headers: {},
    query: {},
  };
}

function buildEditorTypes(
  nodeId: string | null,
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>,
  edges: Array<{ source?: string; target?: string; targetHandle?: string | null; data?: { channel?: string } }>,
  executionByNode: Record<string, { outputs?: Record<string, { value?: unknown }> }>,
  lastPromptInput: { message: string; history?: Record<string, unknown>[]; messages?: unknown[]; attachments?: Record<string, unknown>[] } | null
): string {
  if (!nodeId) {
    return [
      'declare const $input: any;\n',
      'declare const $trigger: any;\n',
      'declare function $<T = any>(name: string): { item: { json: T } };\n',
    ].join('');
  }

  const flowEdges = filterFlowEdges(edges as any);
  const upstreamIds = upstreamClosure([nodeId], flowEdges as any);
  upstreamIds.delete(nodeId);

  const nodesById = new Map(nodes.map(node => [node.id, node]));

  const directInputEdge = flowEdges.find(
    edge => edge.target === nodeId && (edge.targetHandle ?? 'input') === 'input'
  );
  const directInputNode = directInputEdge?.source ? nodesById.get(directInputEdge.source) : undefined;

  const inputSnapshot = directInputNode ? executionByNode[directInputNode.id] : undefined;
  const inputValue = pickPrimaryOutput(inputSnapshot).value;

  let triggerNode: { id: string; type?: string; data?: Record<string, unknown> } | undefined;
  for (const upstreamId of upstreamIds) {
    const candidate = nodesById.get(upstreamId);
    if (!candidate) continue;
    const def = getNodeDefinition(candidate.type || '');
    if (def?.category === 'trigger') {
      triggerNode = candidate;
      break;
    }
  }
  if (!triggerNode) {
    triggerNode = nodes.find(node => getNodeDefinition(node.type || '')?.category === 'trigger');
  }

  const triggerSnapshot = triggerNode ? executionByNode[triggerNode.id] : undefined;
  const promptFallback = lastPromptInput
    ? {
        message: lastPromptInput.message ?? '',
        last_user_message: lastPromptInput.message ?? '',
        history: lastPromptInput.history ?? [],
        messages: lastPromptInput.messages ?? [],
        attachments: lastPromptInput.attachments ?? [],
      }
    : null;
  const triggerValue =
    pickPrimaryOutput(triggerSnapshot).value ??
    promptFallback ??
    buildTriggerFallback();

  const inputType = inferTsType(inputValue);
  const triggerType = inferTsType(triggerValue);

  const typeLines: string[] = [];
  const functionOverloads: string[] = [];
  const seenNames = new Set<string>();

  for (const upstreamId of upstreamIds) {
    const node = nodesById.get(upstreamId);
    if (!node) continue;
    const snapshot = executionByNode[upstreamId];
    const outputValue = pickPrimaryOutput(snapshot).value;
    const nodeName = getNodeName(node as any);
    if (seenNames.has(nodeName)) continue;
    seenNames.add(nodeName);
    const typeName = `Node_${sanitizeTypeName(nodeName)}`;
    const nodeType = inferTsType(outputValue);

    typeLines.push(`type ${typeName} = ${nodeType};`);
    functionOverloads.push(
      `declare function $(name: ${JSON.stringify(nodeName)}): { item: { json: ${typeName} } };`
    );
  }

  return [
    '// Flow runtime globals\n',
    `type InputValue = ${inputType};`,
    `type TriggerValue = ${triggerType};`,
    'declare const $input: InputValue;\n',
    'declare const $trigger: TriggerValue;\n',
    ...typeLines,
    ...functionOverloads,
    'declare function $<T = any>(name: string): { item: { json: T } };\n',
  ].join('\n');
}

export function CodeControl({ param, value, onChange, compact, nodeId }: CodeControlProps) {
  const p = param as { default?: string; placeholder?: string; rows?: number; language?: string; panelLayout?: 'default' | 'full' };
  const isFull = p.panelLayout === 'full';
  const currentValue = value ?? p.default ?? '';
  const resolvedTheme = useResolvedTheme();
  const monaco = useMonaco();
  const libRef = useRef<{ dispose: () => void } | null>(null);
  const configuredRef = useRef(false);
  const [isActive, setIsActive] = useState(false);

  const { nodes, edges } = useFlowState();
  const { executionByNode, lastPromptInput } = useFlowExecution();

  const [editorValue, setEditorValue] = useState(currentValue);

  useEffect(() => {
    setEditorValue(currentValue);
  }, [currentValue]);

  const extraLib = useMemo(
    () => buildEditorTypes(nodeId ?? null, nodes, edges, executionByNode, lastPromptInput),
    [nodeId, nodes, edges, executionByNode, lastPromptInput]
  );

  useEffect(() => {
    if (!monaco || !isActive) return;

    if (!configuredRef.current) {
      monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        diagnosticCodesToIgnore: [1108],
      });
      monaco.typescript.javascriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true,
        target: monaco.typescript.ScriptTarget.ES2020,
        moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
        checkJs: true,
      });
      monaco.typescript.javascriptDefaults.setEagerModelSync(true);
      configuredRef.current = true;
    }

    if (libRef.current) {
      libRef.current.dispose();
    }

    const libUri = `inmemory://model/flow-code-context/${nodeId ?? 'global'}.d.ts`;
    libRef.current = monaco.typescript.javascriptDefaults.addExtraLib(extraLib, libUri);

    return () => {
      libRef.current?.dispose();
      libRef.current = null;
    };
  }, [monaco, extraLib, nodeId, isActive]);

  const rows = compact ? 6 : p.rows ?? 8;
  const height = isFull ? '100%' : `${rows * 22 + 24}px`;

  return (
    <div className={cn('border rounded-md overflow-visible', isFull && 'h-full w-full border-0 rounded-none')}>
      <Editor
        height={height}
        language={p.language ?? 'javascript'}
        value={editorValue}
        onMount={(editor) => {
          const focusDisposable = editor.onDidFocusEditorText(() => setIsActive(true));
          const blurDisposable = editor.onDidBlurEditorText(() => setIsActive(false));

          return () => {
            focusDisposable.dispose();
            blurDisposable.dispose();
          };
        }}
        onChange={(next) => {
          const updated = next ?? '';
          setEditorValue(updated);
          onChange(updated);
        }}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          padding: isFull ? { top: 0, bottom: 0 } : { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
