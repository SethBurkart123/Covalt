import type { JSONContent } from '@tiptap/core';
import type { TemplateVariableOption } from './types';

interface TemplateTokenText {
  type: 'text';
  text: string;
}

interface TemplateTokenVariable {
  type: 'variable';
  expr: string;
}

type TemplateToken = TemplateTokenText | TemplateTokenVariable;

const TEMPLATE_EXPRESSION_REGEX = /{{\s*([^}]+?)\s*}}/g;

export function extractExpressionFromText(value: string): string | null {
  const match = value.match(/^\s*{{\s*([\s\S]+?)\s*}}\s*$/);
  if (!match) return null;
  const expr = match[1]?.trim();
  return expr ? expr : null;
}

export function filterTemplateVariables(
  options: TemplateVariableOption[],
  query: string
): TemplateVariableOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return options;

  return options.filter(option => {
    const haystacks = [option.label, option.expr, option.group].filter(Boolean) as string[];
    return haystacks.some(text => text.toLowerCase().includes(trimmed));
  });
}

export function formatPreviewDisplay(preview: string | undefined | null): string {
  if (preview === undefined || preview === null) return 'No preview yet';
  if (preview === '') return '(empty)';
  return preview;
}

export function getExpressionGroup(expr: string): string | null {
  const trimmed = expr.trim();
  if (
    trimmed === '$input'
    || trimmed.startsWith('$input.')
    || trimmed.startsWith('$input[')
    || trimmed === 'input'
    || trimmed.startsWith('input.')
    || trimmed.startsWith('input[')
  ) {
    return 'Input';
  }

  if (
    trimmed === '$trigger'
    || trimmed.startsWith('$trigger.')
    || trimmed.startsWith('$trigger[')
    || trimmed === 'trigger'
    || trimmed.startsWith('trigger.')
    || trimmed.startsWith('trigger[')
  ) {
    return 'Trigger';
  }

  const nodeMatch = trimmed.match(/^\$\(['"](.+?)['"]\)\.item\.json(?:\.|\[|$)/);
  if (!nodeMatch) return null;

  return nodeMatch[1]?.replace(/\\'/g, "'").replace(/\\"/g, '"') ?? null;
}

export function templateStringToDoc(value: string): JSONContent {
  const paragraphs = value.split(/\n/);
  return {
    type: 'doc',
    content: paragraphs.map(paragraph => ({
      type: 'paragraph',
      content: buildParagraphContent(paragraph),
    })),
  };
}

function buildParagraphContent(paragraph: string): JSONContent[] {
  const tokens = parseTemplateTokens(paragraph);
  const content: JSONContent[] = [];

  for (const token of tokens) {
    if (token.type === 'text') {
      if (!token.text) continue;
      content.push({ type: 'text', text: token.text });
      continue;
    }

    content.push({
      type: 'templateVar',
      attrs: { expr: token.expr },
      content: [{ type: 'text', text: token.expr }],
    });
  }

  return content;
}

function parseTemplateTokens(text: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TEMPLATE_EXPRESSION_REGEX)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, matchIndex) });
    }

    const expr = match[1]?.trim();
    if (expr) {
      tokens.push({ type: 'variable', expr });
    } else {
      tokens.push({ type: 'text', text: match[0] });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return tokens;
}
