'use client';

import { useEffect, useMemo, useState } from 'react';
import { InputRule, Node, PasteRule, mergeAttributes } from '@tiptap/core';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  ReactRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  TemplateVariableCompletionList,
  type TemplateVariableCompletionListHandle,
} from './template-variable-completion';
import { TemplateVariablePicker } from './template-variable-picker';
import { formatPreviewDisplay } from './template-variable-utils';
import type { TemplateVariableCompletion, TemplateVariableOption } from './types';
import {
  TemplateVariableSuggestionList,
  type TemplateVariableSuggestionListHandle,
} from './template-variable-suggestion';

export interface TemplateVariableAttrs {
  expr?: string | null;
  preview?: string | null;
}

interface TemplateVariableExtensionOptions {
  getSuggestions: (query: string) => TemplateVariableOption[];
  getPreview: (expr: string) => string | undefined;
  getMeta: (expr: string) => { isValid: boolean; hasData: boolean };
  getCompletions: (args: { prefix: string; query: string; trigger: '.' | '[' }) => TemplateVariableCompletion[];
}

type SuggestionRendererProps = SuggestionProps<TemplateVariableOption, TemplateVariableOption>;
type CompletionSuggestionRendererProps = SuggestionProps<
  TemplateVariableCompletion,
  TemplateVariableCompletion
>;

const TEMPLATE_INPUT_REGEX = /{{\s*([^}]+?)\s*}}$/;
const TEMPLATE_PASTE_REGEX = /{{\s*([^}]+?)\s*}}/g;

export const TemplateVariable = Node.create<TemplateVariableExtensionOptions>({
  name: 'templateVar',
  group: 'inline',
  inline: true,
  content: 'text*',
  atom: false,
  selectable: false,
  draggable: false,
  defining: true,
  isolating: true,

  addOptions() {
    return {
      getSuggestions: () => [],
      getPreview: () => undefined,
      getMeta: () => ({ isValid: true, hasData: true }),
      getCompletions: () => [],
    };
  },

  addAttributes() {
    return {
      expr: {
        default: null,
        parseHTML: element => element.getAttribute('data-expr'),
        renderHTML: attributes => ({
          'data-expr': attributes.expr,
        }),
      },
      preview: {
        default: null,
        parseHTML: element => element.getAttribute('data-preview'),
        renderHTML: attributes => ({
          'data-preview': attributes.preview,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-template-var]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { class: 'template-var-pill', 'data-template-var': 'true', 'data-expr': node.attrs.expr },
        HTMLAttributes
      ),
      0,
    ];
  },

  renderText({ node }) {
    const expr = node.textContent || node.attrs.expr || '';
    return `{{ ${expr} }}`;
  },

  addInputRules() {
    return [
      new InputRule({
        find: TEMPLATE_INPUT_REGEX,
        handler: ({ state, range, match, commands }) => {
          const expr = match[1]?.trim();
          if (!expr) return null;
          const attrs = createTemplateVariableAttrs({ expr });
          const textNode = state.schema.text(expr);
          commands.insertContentAt(range, this.type.create(attrs, textNode));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: TEMPLATE_PASTE_REGEX,
        handler: ({ state, range, match, commands }) => {
          const expr = match[1]?.trim();
          if (!expr) return null;
          const attrs = createTemplateVariableAttrs({ expr });
          const textNode = state.schema.text(expr);
          commands.insertContentAt(range, this.type.create(attrs, textNode));
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const plugins = [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('templateVarSuggestion'),
        char: '{',
        allowSpaces: true,
        allow: ({ state, range }) => {
          const from = Math.max(range.from - 1, 0);
          const previousChar = state.doc.textBetween(from, range.from);
          return previousChar === '{';
        },
        items: ({ query }) => this.options.getSuggestions(query).slice(0, 20),
        command: ({ editor, range, props }) => {
          const attrs = createTemplateVariableAttrs({ expr: props.expr, preview: props.preview });
          const nodeType = editor.state.schema.nodes.templateVar;
          if (!nodeType) return;
          const textNode = props.expr ? editor.state.schema.text(props.expr) : null;
          const node = nodeType.create(attrs, textNode ?? undefined);
          editor.chain().focus().insertContentAt(range, node).run();
        },
        render: () => createSuggestionRenderer(),
      }),
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('templateVarCompletionDot'),
        char: '.',
        allowedPrefixes: null,
        allowSpaces: false,
        allow: ({ state, range }) =>
          isInsideTemplateVar(state, range, this.name) && Boolean(getCompletionContext(state, '.', '')),
        items: ({ query, editor }) => {
          const context = getCompletionContext(editor.state, '.', query);
          if (!context) return [];
          return this.options.getCompletions({
            prefix: context.prefix,
            query: context.query,
            trigger: '.',
          });
        },
        command: ({ editor, range, props }) => {
          const insertText = props.insertText ?? props.label;
          const from = insertText.startsWith('[') ? range.from : range.from + 1;
          editor
            .chain()
            .focus()
            .insertContentAt({ from, to: range.to }, insertText)
            .run();
        },
        render: () => createCompletionRenderer(),
      }),
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('templateVarCompletionBracket'),
        char: '[',
        allowedPrefixes: null,
        allowSpaces: false,
        allow: ({ state, range }) =>
          isInsideTemplateVar(state, range, this.name) && Boolean(getCompletionContext(state, '[', '')),
        items: ({ query, editor }) => {
          const context = getCompletionContext(editor.state, '[', query);
          if (!context) return [];
          return this.options.getCompletions({
            prefix: context.prefix,
            query: context.query,
            trigger: '[',
          });
        },
        command: ({ editor, range, props }) => {
          const insertText = props.insertText ?? props.label;
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from + 1, to: range.to }, insertText)
            .run();
        },
        render: () => createCompletionRenderer(),
      }),
    ];

    plugins.push(new Plugin({
      key: new PluginKey('templateVarCleanupEmpty'),
      appendTransaction: (_transactions, _oldState, newState) => {
        let tr = newState.tr;
        let changed = false;
        const type = newState.schema.nodes.templateVar;
        if (!type) return null;

        newState.doc.descendants((node, pos) => {
          if (node.type !== type) return;
          if (node.textContent.length > 0) return;
          tr = tr.delete(pos, pos + node.nodeSize);
          changed = true;
        });

        return changed ? tr : null;
      },
    }));

    return plugins;
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => (
      <TemplateVariableNodeView
        {...props}
        getPreview={this.options.getPreview}
        getSuggestions={this.options.getSuggestions}
        getMeta={this.options.getMeta}
        getCompletions={this.options.getCompletions}
      />
    ));
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const view = this.editor.view;
        if (!view) return false;
        const { state } = view;
        const { dispatch } = view;
        const { selection } = state;

        if (!selection.empty) return false;

        const { $from } = selection;
        if ($from.parent.type.name === this.name) {
          const parentNode = $from.parent;
          if (parentNode.textContent.length > 0) return false;

          const start = $from.before();
          dispatch(state.tr.delete(start, start + parentNode.nodeSize));
          return true;
        }

        const nodeBefore = $from.nodeBefore;
        if (nodeBefore?.type.name === this.name) {
          const start = $from.pos - nodeBefore.nodeSize;
          dispatch(state.tr.delete(start, $from.pos));
          return true;
        }

        return false;
      },
    };
  },

});

function createSuggestionRenderer() {
  let component: ReactRenderer<TemplateVariableSuggestionListHandle> | null = null;
  let container: HTMLDivElement | null = null;
  let currentProps: SuggestionRendererProps | null = null;

  const updatePosition = () => {
    if (!container) return;
    const rect = currentProps?.clientRect?.();
    if (!rect) return;

    container.style.left = `${rect.left}px`;
    container.style.top = `${rect.bottom + 6}px`;
  };

  return {
    onStart: (props: SuggestionRendererProps) => {
      currentProps = props;
      container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.zIndex = '9999';
      document.body.appendChild(container);

      component = new ReactRenderer(TemplateVariableSuggestionList, {
        props: {
          items: props.items,
          command: props.command,
        },
        editor: props.editor,
      });

      container.appendChild(component.element);
      updatePosition();
    },

    onUpdate: (props: SuggestionRendererProps) => {
      currentProps = props;
      component?.updateProps({
        items: props.items,
        command: props.command,
      });
      updatePosition();
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') {
        return false;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },

    onExit: () => {
      currentProps = null;
      component?.destroy();
      container?.remove();
      component = null;
      container = null;
    },
  };
}

function TemplateVariableNodeView({
  node,
  updateAttributes,
  editor,
  getPos,
  getPreview,
  getSuggestions,
  getMeta,
}: NodeViewProps & TemplateVariableExtensionOptions) {
  const [open, setOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const attrs = node.attrs as TemplateVariableAttrs;
  const expr = node.textContent || attrs.expr || '';
  const placeholderExpr = attrs.expr ?? '';

  const preview = useMemo(() => {
    return formatPreviewDisplay(attrs.preview ?? getPreview(expr));
  }, [attrs.preview, expr, getPreview]);

  const options = useMemo(() => (open ? getSuggestions('') : []), [getSuggestions, open]);
  const meta = useMemo(() => getMeta(expr), [expr, getMeta]);
  const isInvalid = meta.hasData && !meta.isValid;

  useEffect(() => {
    if (typeof getPos !== 'function') return;

    const updateEditing = () => {
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const { from, to } = editor.state.selection;
      const isActive = from >= pos && to <= pos + node.nodeSize;
      setIsEditing(isActive && editor.isFocused);
    };

    editor.on('selectionUpdate', updateEditing);
    editor.on('focus', updateEditing);
    editor.on('blur', updateEditing);

    updateEditing();

    return () => {
      editor.off('selectionUpdate', updateEditing);
      editor.off('focus', updateEditing);
      editor.off('blur', updateEditing);
    };
  }, [editor, getPos, node.nodeSize]);

  const handleSelect = (option: TemplateVariableOption) => {
    const position = typeof getPos === 'function' ? getPos() : null;
    if (typeof position === 'number') {
      const nodeType = editor.state.schema.nodes.templateVar;
      if (nodeType) {
        const attrs = createTemplateVariableAttrs({ expr: option.expr, preview: option.preview ?? null });
        const content = option.expr ? editor.state.schema.text(option.expr) : null;
        editor.view.dispatch(
          editor.state.tr.replaceWith(position, position + node.nodeSize, nodeType.create(attrs, content))
        );
        setOpen(false);
        editor.commands.focus();
        return;
      }
    }

    updateAttributes(createTemplateVariableAttrs({ expr: option.expr, preview: option.preview ?? null }));
    setOpen(false);
    editor.commands.focus();
  };

  return (
    <NodeViewWrapper as="span" className="relative inline-flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip open={isHovering || isEditing}>
          <TooltipTrigger asChild>
            <PopoverAnchor asChild>
              <span
                title={expr}
                onDoubleClick={() => setOpen(true)}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  isInvalid
                    ? 'border-border/70 bg-muted/60 text-muted-foreground'
                    : 'border-primary/30 bg-primary/10 text-primary hover:border-primary/50 hover:bg-primary/15'
                )}
              >
                <NodeViewContent
                  data-placeholder={placeholderExpr}
                  className="template-var-content outline-none"
                  onFocus={() => setOpen(true)}
                  onBlur={() => setOpen(false)}
                />
              </span>
            </PopoverAnchor>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-xs z-[200]">
            {preview}
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="p-2 w-72 z-[200]" align="start" sideOffset={6}>
          <TemplateVariablePicker options={options} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

function createTemplateVariableAttrs(
  attrs?: { expr?: string; preview?: string | null }
): TemplateVariableAttrs {
  return {
    expr: attrs?.expr ?? null,
    preview: attrs?.preview ?? null,
  };
}

function isInsideTemplateVar(
  state: { doc: { resolve: (pos: number) => { parent: { type: { name: string } } } } },
  range: { from: number } | null | undefined,
  name: string
): boolean {
  if (!range) return false;
  const $from = state.doc.resolve(range.from);
  return $from.parent.type.name === name;
}

function getCompletionContext(
  state: {
    selection: {
      $from: {
        parent: { type: { name: string }; textContent: string };
        parentOffset: number;
      };
    };
  },
  trigger: '.' | '[',
  fallbackQuery: string
): { prefix: string; query: string } | null {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'templateVar') return null;

  const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
  const lastDot = textBefore.lastIndexOf('.');
  const lastBracket = textBefore.lastIndexOf('[');
  const lastClose = textBefore.lastIndexOf(']');

  if (trigger === '.') {
    if (lastDot === -1) return null;
    // If we're inside an unclosed bracket segment after the dot, don't offer dot completions.
    if (lastBracket > lastDot && lastClose < lastBracket) return null;
    const prefix = textBefore.slice(0, lastDot + 1);
    const query = textBefore.slice(lastDot + 1) || fallbackQuery;
    return { prefix, query };
  }

  if (trigger === '[') {
    if (lastBracket === -1) return null;
    const chunk = textBefore.slice(lastBracket);
    if (chunk.includes(']')) return null;
    const prefix = textBefore.slice(0, lastBracket + 1);
    const query = textBefore.slice(lastBracket + 1) || fallbackQuery;
    return { prefix, query };
  }

  return null;
}

function createCompletionRenderer() {
  let component: ReactRenderer<TemplateVariableCompletionListHandle> | null = null;
  let container: HTMLDivElement | null = null;
  let editorInstance: {
    view?: { coordsAtPos: (pos: number) => { left: number; right: number; top: number; bottom: number } };
    state?: { selection?: { from: number } };
    isFocused?: boolean;
    on?: (event: string, handler: () => void) => void;
    off?: (event: string, handler: () => void) => void;
  } | null = null;
  let lastRange: { from: number } | null = null;
  let cleanupAutoUpdate: (() => void) | null = null;
  let getReferenceRect: (() => DOMRect | null) | null = null;

  const updatePosition = () => {
    if (!container) return;
    if (!getReferenceRect) return;
    const reference: VirtualElement = {
      getBoundingClientRect: () => getReferenceRect?.() ?? new DOMRect(),
    };

    void computePosition(reference, container, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (!container) return;
      container.style.left = `${x}px`;
      container.style.top = `${y}px`;
    });
  };

  const startAutoUpdate = () => {
    if (!container || cleanupAutoUpdate) return;
    const reference: VirtualElement = {
      getBoundingClientRect: () => getReferenceRect?.() ?? new DOMRect(),
    };
    cleanupAutoUpdate = autoUpdate(reference, container, () => {
      if (editorInstance && editorInstance.isFocused === false) {
        handleBlur();
        return;
      }
      updatePosition();
    }, { animationFrame: true });
  };

  const stopAutoUpdate = () => {
    if (!cleanupAutoUpdate) return;
    cleanupAutoUpdate();
    cleanupAutoUpdate = null;
  };

  const handleBlur = () => {
    stopAutoUpdate();
    if (editorInstance?.off) {
      editorInstance.off('blur', handleBlur);
    }
    component?.destroy();
    container?.remove();
    component = null;
    container = null;
    editorInstance = null;
    lastRange = null;
    getReferenceRect = null;
  };

  return {
    onStart: (props: CompletionSuggestionRendererProps) => {
      container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.zIndex = '9999';
      document.body.appendChild(container);

      component = new ReactRenderer(TemplateVariableCompletionList, {
        props: {
          items: props.items,
          command: props.command,
        },
        editor: props.editor,
      });

      container.appendChild(component.element);
      lastRange = props.range ?? null;
      editorInstance = props.editor as typeof editorInstance;
      getReferenceRect = () => {
        const rect = props.clientRect?.();
        if (rect) return rect;
        if (editorInstance?.view?.coordsAtPos) {
          const pos = lastRange?.from ?? editorInstance.state?.selection?.from;
          if (typeof pos === 'number') {
            const coords = editorInstance.view.coordsAtPos(pos);
            return new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
          }
        }
        return null;
      };
      updatePosition();
      startAutoUpdate();

      window.addEventListener('blur', handleBlur);
      editorInstance?.on?.('blur', handleBlur);
    },

    onUpdate: (props: CompletionSuggestionRendererProps) => {
      component?.updateProps({
        items: props.items,
        command: props.command,
      });
      lastRange = props.range ?? lastRange;
      getReferenceRect = () => {
        const rect = props.clientRect?.();
        if (rect) return rect;
        if (editorInstance?.view?.coordsAtPos) {
          const pos = lastRange?.from ?? editorInstance.state?.selection?.from;
          if (typeof pos === 'number') {
            const coords = editorInstance.view.coordsAtPos(pos);
            return new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
          }
        }
        return null;
      };
      updatePosition();
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') {
        return false;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },

    onExit: () => {
      window.removeEventListener('blur', handleBlur);
      stopAutoUpdate();
      editorInstance?.off?.('blur', handleBlur);
      component?.destroy();
      container?.remove();
      component = null;
      container = null;
      editorInstance = null;
      lastRange = null;
      getReferenceRect = null;
    },
  };
}
