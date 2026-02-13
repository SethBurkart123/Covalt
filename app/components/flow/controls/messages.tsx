'use client';

import { useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TemplateEditor } from '../template-editor';
import type { ControlProps } from './';

const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;

type MessageRole = typeof MESSAGE_ROLES[number];

interface MessageItem {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCallFunction {
  name: string;
  arguments: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

interface MessagesExpressionValue {
  mode: 'expression';
  expression: string;
}

interface MessagesManualValue {
  mode: 'manual';
  messages: MessageItem[];
}

type MessagesValue = MessagesExpressionValue | MessagesManualValue;

function isMessageRole(value: unknown): value is MessageRole {
  return typeof value === 'string' && MESSAGE_ROLES.includes(value as MessageRole);
}

function normalizeMessages(value: unknown): MessageItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const role = isMessageRole((item as { role?: unknown }).role)
        ? (item as { role: MessageRole }).role
        : 'user';
      const contentValue = (item as { content?: unknown }).content;
      const content = typeof contentValue === 'string' ? contentValue : '';
      const tool_calls = normalizeToolCalls(raw.tool_calls ?? raw.toolCalls);
      const tool_call_id = normalizeToolCallId(raw.tool_call_id ?? raw.toolCallId);
      return {
        role,
        content,
        tool_calls: tool_calls.length ? tool_calls : undefined,
        tool_call_id,
      } satisfies MessageItem;
    })
    .filter((item): item is MessageItem => item !== null);
}

function normalizeToolCallId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return undefined;
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeToolCall(item))
    .filter((item): item is ToolCall => item !== null);
}

function normalizeToolCall(value: unknown): ToolCall | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const functionValue = raw.function as Record<string, unknown> | undefined;
  const nameValue = raw.toolName ?? functionValue?.name;
  const argsValue = raw.toolArgs ?? functionValue?.arguments;

  const name = typeof nameValue === 'string' ? nameValue : '';
  const argumentsText = typeof argsValue === 'string'
    ? argsValue
    : JSON.stringify(argsValue ?? {});

  const idValue = raw.id;
  const id = typeof idValue === 'string' ? idValue : '';

  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: argumentsText,
    },
  };
}

function normalizeValue(value: unknown, fallbackExpression: string): MessagesValue {
  if (value && typeof value === 'object') {
    const mode = (value as { mode?: unknown }).mode;
    if (mode === 'expression') {
      const expression = (value as { expression?: unknown }).expression;
      return {
        mode: 'expression',
        expression: typeof expression === 'string' ? expression : fallbackExpression,
      };
    }
    if (mode === 'manual') {
      const messages = normalizeMessages((value as { messages?: unknown }).messages);
      return { mode: 'manual', messages };
    }
    if (Array.isArray((value as { messages?: unknown }).messages)) {
      return {
        mode: 'manual',
        messages: normalizeMessages((value as { messages?: unknown }).messages),
      };
    }
    if (typeof (value as { expression?: unknown }).expression === 'string') {
      return {
        mode: 'expression',
        expression: (value as { expression: string }).expression,
      };
    }
  }

  if (typeof value === 'string') {
    return { mode: 'expression', expression: value };
  }

  if (Array.isArray(value)) {
    return { mode: 'manual', messages: normalizeMessages(value) };
  }

  return { mode: 'expression', expression: fallbackExpression };
}

interface MessagesControlProps extends Omit<ControlProps, 'onChange'> {
  value: unknown;
  onChange: (value: MessagesValue) => void;
}

export function MessagesControl({ param, value, onChange, compact, nodeId }: MessagesControlProps) {
  const label = param.label || 'Messages';
  const fallbackExpression = useMemo(() => {
    const p = param as { default?: unknown };
    const defaultValue = p.default;
    if (typeof defaultValue === 'string') return defaultValue;
    if (defaultValue && typeof defaultValue === 'object') {
      const expr = (defaultValue as { expression?: unknown }).expression;
      if (typeof expr === 'string') return expr;
    }
    return '';
  }, [param]);

  const currentValue = useMemo(() => normalizeValue(value, fallbackExpression), [value, fallbackExpression]);

  const setMode = useCallback((mode: MessagesValue['mode']) => {
    if (mode === currentValue.mode) return;
    if (mode === 'expression') {
      onChange({ mode: 'expression', expression: fallbackExpression });
      return;
    }
    onChange({ mode: 'manual', messages: [] });
  }, [currentValue.mode, fallbackExpression, onChange]);

  const updateExpression = useCallback((nextExpression: string) => {
    onChange({ mode: 'expression', expression: nextExpression });
  }, [onChange]);

  const updateMessageRole = useCallback((index: number, nextRole: MessageRole) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages];
    const message = nextMessages[index];
    if (!message) return;
    const cleared = { ...message, role: nextRole };
    if (nextRole !== 'assistant') {
      delete cleared.tool_calls;
    }
    if (nextRole !== 'tool') {
      delete cleared.tool_call_id;
    }
    nextMessages[index] = cleared;
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const updateMessageContent = useCallback((index: number, nextContent: string) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages];
    const message = nextMessages[index];
    if (!message) return;
    nextMessages[index] = { ...message, content: nextContent };
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const updateToolCallId = useCallback((index: number, nextId: string) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages];
    const message = nextMessages[index];
    if (!message) return;
    nextMessages[index] = { ...message, tool_call_id: nextId };
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const addToolCall = useCallback((index: number) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages];
    const message = nextMessages[index];
    if (!message) return;
    const toolCalls = message.tool_calls ? [...message.tool_calls] : [];
    toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '{}' } });
    nextMessages[index] = { ...message, tool_calls: toolCalls };
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const updateToolCall = useCallback((
    index: number,
    callIndex: number,
    update: Partial<ToolCallFunction> & { id?: string }
  ) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages];
    const message = nextMessages[index];
    if (!message || !message.tool_calls) return;
    const nextToolCalls = [...message.tool_calls];
    const call = nextToolCalls[callIndex];
    if (!call) return;
    nextToolCalls[callIndex] = {
      ...call,
      id: update.id ?? call.id,
      function: {
        name: update.name ?? call.function.name,
        arguments: update.arguments ?? call.function.arguments,
      },
    };
    nextMessages[index] = { ...message, tool_calls: nextToolCalls };
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const removeToolCall = useCallback((index: number, callIndex: number) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages];
    const message = nextMessages[index];
    if (!message || !message.tool_calls) return;
    const nextToolCalls = message.tool_calls.filter((_, i) => i !== callIndex);
    nextMessages[index] = {
      ...message,
      tool_calls: nextToolCalls.length ? nextToolCalls : undefined,
    };
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const addMessage = useCallback(() => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = [...currentValue.messages, { role: 'user', content: '' }];
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  const removeMessage = useCallback((index: number) => {
    if (currentValue.mode !== 'manual') return;
    const nextMessages = currentValue.messages.filter((_, i) => i !== index);
    onChange({ mode: 'manual', messages: nextMessages });
  }, [currentValue, onChange]);

  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn(compact ? 'text-[10px]' : 'text-[11px]', 'font-medium text-muted-foreground')}>
          {label}
        </span>
        <Select value={currentValue.mode} onValueChange={(val) => setMode(val as MessagesValue['mode'])}>
          <SelectTrigger
            size="sm"
            className={cn(
              compact ? 'h-6 text-[11px] px-2 py-0.5' : 'h-7 text-xs px-2 py-0.5',
              'w-[100px]'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expression">Expression</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {currentValue.mode === 'expression' ? (
        <TemplateEditor
          value={currentValue.expression}
          onChange={updateExpression}
          placeholder="{{ $input.messages }}"
          multiline
          compact={compact}
          rows={compact ? 2 : 3}
          nodeId={nodeId}
        />
      ) : (
        <div className="space-y-2">
          {currentValue.messages.length > 0 && (
            currentValue.messages.map((message, index) => (
              <div
                key={`message-${index}`}
                className="rounded-md border border-border/70 bg-background/50 p-1.5 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <Select
                    value={message.role}
                    onValueChange={(val) => updateMessageRole(index, val as MessageRole)}
                  >
                    <SelectTrigger
                      size="sm"
                      className={compact ? 'h-6 text-xs w-[100px] px-2 py-0.5' : 'h-7 text-xs w-[110px] px-2 py-0.5'}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MESSAGE_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => removeMessage(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {message.role === 'tool' && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Tool call id
                    </label>
                    <Input
                      value={message.tool_call_id ?? ''}
                      onChange={(event) => updateToolCallId(index, event.target.value)}
                      className={compact ? 'h-6 text-xs px-2 py-1' : 'h-7 text-xs px-2 py-1'}
                      placeholder="tool_call_id"
                    />
                  </div>
                )}

                <TemplateEditor
                  value={message.content}
                  onChange={(next) => updateMessageContent(index, next)}
                  placeholder="Message content"
                  multiline
                  compact={compact}
                  rows={compact ? 2 : 2}
                  nodeId={nodeId}
                />

                {message.role === 'assistant' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-muted-foreground">Tool calls</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => addToolCall(index)}
                      >
                        Add tool call
                      </Button>
                    </div>

                    {(message.tool_calls && message.tool_calls.length > 0) ? (
                      <div className="space-y-2">
                        {message.tool_calls.map((toolCall, callIndex) => (
                          <div
                            key={`tool-call-${index}-${callIndex}`}
                            className="rounded-md border border-border/70 bg-background/60 p-1.5 space-y-1.5"
                          >
                            <div className="flex items-center gap-2">
                              <Input
                                value={toolCall.id}
                                onChange={(event) => updateToolCall(index, callIndex, { id: event.target.value })}
                                className={compact ? 'h-6 text-xs px-2 py-1' : 'h-7 text-xs px-2 py-1'}
                                placeholder="tool_call_id"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => removeToolCall(index, callIndex)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>

                            <Input
                              value={toolCall.function.name}
                              onChange={(event) => updateToolCall(index, callIndex, { name: event.target.value })}
                              className={compact ? 'h-6 text-xs px-2 py-1' : 'h-7 text-xs px-2 py-1'}
                              placeholder="function name"
                            />

                            <TemplateEditor
                              value={toolCall.function.arguments}
                              onChange={(next) => updateToolCall(index, callIndex, { arguments: next })}
                              placeholder="arguments (JSON)"
                              multiline
                              compact={compact}
                              rows={compact ? 2 : 3}
                              nodeId={nodeId}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tool calls yet.</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={addMessage}
          >
            Add message
          </Button>
        </div>
      )}
    </div>
  );
}
