
import { memo, use, useEffect, useLayoutEffect, useRef } from 'react';
import { Idiomorph } from 'idiomorph';
import katex from 'katex';
import { init as initMd4w, mdToHtml, setCodeHighlighter } from 'md4w';
import md4wWasmUrl from 'md4w-wasm?url';
import { Prism } from 'prism-react-renderer';
import { cn } from '@/lib/utils';
import { preprocessPartialMarkdown } from '@/lib/markdown/partial';
import './md4w-renderer.css';
const MD4W_EQUATION_OPEN = '<x-equation';
const MD4W_EQUATION_CLOSE = '</x-equation>';
const MD4W_PARSE_FLAGS = [
  'TABLES',
  'STRIKETHROUGH',
  'TASKLISTS',
  'LATEX_MATH_SPANS',
  'PERMISSIVE_URL_AUTO_LINKS',
  'PERMISSIVE_ATX_HEADERS',
  'COLLAPSE_WHITESPACE',
  'NO_HTML_BLOCKS',
  'NO_HTML_SPANS',
] as const;

let md4wReady = false;
let md4wInitPromise: Promise<void> | null = null;
let highlighterConfigured = false;

if (typeof window !== 'undefined') {
  void ensureMd4w();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-fA-F]+)|amp|lt|gt|quot|apos);/g, (entity, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (entity === '&amp;') return '&';
    if (entity === '&lt;') return '<';
    if (entity === '&gt;') return '>';
    if (entity === '&quot;') return '"';
    if (entity === '&apos;') return "'";
    return entity;
  });
}

const COPY_ICON = /* html */'<svg class="markdown-code-copy-icon" data-copy-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const CHECK_ICON = /* html */'<svg class="markdown-code-check-icon" data-check-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const TYPEWRITER_INDICATOR_HTML =
  '<span class="inline-typewriter-indicator" data-stream-indicator="true" aria-hidden="true"></span>';

function highlightCode(language: string, code: string): string {
  const safeLanguage = language.replace(/[^\w-]/g, '') || 'text';
  const grammar = Prism.languages[safeLanguage] ?? Prism.languages.text;
  const codeString = code.replace(/\n$/, '');
  const highlighted = grammar ? Prism.highlight(codeString, grammar, safeLanguage) : escapeHtml(codeString);

  return /* html */`<div class="markdown-code-block group/code"><div class="markdown-code-copy-overlay"><button type="button" class="markdown-code-copy" title="Copy code">${COPY_ICON}${CHECK_ICON}</button></div><pre><code class="language-${safeLanguage}">${highlighted}</code></pre></div>`;
}

function configureHighlighter(): void {
  if (highlighterConfigured) return;
  setCodeHighlighter((language, code) => highlightCode(language, code));
  highlighterConfigured = true;
}

function ensureMd4w(): Promise<void> {
  configureHighlighter();
  if (md4wReady) return Promise.resolve();
  // Pass a Response so md4w skips its universal-FS path, which under Vite
  // tries to import `node:fs/promises` because `globalThis.process` is defined.
  md4wInitPromise ??= initMd4w(fetch(md4wWasmUrl)).then(() => {
    md4wReady = true;
  }).catch(error => {
    console.warn('md4w failed to initialise; falling back to plain text.', error);
  });
  return md4wInitPromise;
}

function renderMd4wMath(html: string): string {
  let cursor = 0;
  const chunks: string[] = [];

  while (true) {
    const openStart = html.indexOf(MD4W_EQUATION_OPEN, cursor);
    if (openStart === -1) break;

    const openEnd = html.indexOf('>', openStart + MD4W_EQUATION_OPEN.length);
    if (openEnd === -1) break;

    const closeStart = html.indexOf(MD4W_EQUATION_CLOSE, openEnd + 1);
    if (closeStart === -1) break;

    chunks.push(html.slice(cursor, openStart));
    const openTag = html.slice(openStart, openEnd + 1);
    const body = html.slice(openEnd + 1, closeStart);
    const latex = body.includes('&') ? decodeHtmlEntities(body) : body;
    const displayMode = openTag.includes('type="display"') || openTag.includes("type='display'");
    chunks.push(katex.renderToString(latex.trim(), { displayMode, throwOnError: false }));
    cursor = closeStart + MD4W_EQUATION_CLOSE.length;
  }

  if (chunks.length === 0) return html;
  chunks.push(html.slice(cursor));
  return chunks.join('');
}

function restoreSafeDetails(html: string): string {
  return html
    .split('<p>&lt;details&gt;\n&lt;summary&gt;').join('<details><summary>')
    .split('&lt;/summary&gt;</p>').join('</summary>')
    .split('<p>&lt;/details&gt;</p>').join('</details>')
    .split('&lt;strong&gt;').join('<strong>')
    .split('&lt;/strong&gt;').join('</strong>');
}

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const SAFE_DATA_URL_PREFIXES = ['data:image/png;', 'data:image/jpeg;', 'data:image/gif;', 'data:image/webp;'];

function isSafeGeneratedUrl(value: string): boolean {
  const decoded = decodeHtmlEntities(value).trim().replace(/[\u0000-\u001F\u007F\s]+/g, '');
  if (!decoded) return false;
  if (decoded.startsWith('#') || decoded.startsWith('/') || decoded.startsWith('./') || decoded.startsWith('../')) return true;
  const lower = decoded.toLowerCase();
  if (SAFE_DATA_URL_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
  try {
    const url = new URL(decoded);
    return SAFE_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function scrubGeneratedUrls(html: string): string {
  return html.replace(/\s(href|src)="([^"]*)"/g, (match, attr: string, value: string) => {
    if (!isSafeGeneratedUrl(value)) return ` ${attr}="#"`;
    if (attr === 'href') return ` href="${value}" target="_blank" rel="noreferrer"`;
    return match;
  });
}

function createTypewriterIndicator(): HTMLSpanElement {
  const indicator = document.createElement('span');
  indicator.className = 'inline-typewriter-indicator';
  indicator.dataset.streamIndicator = 'true';
  indicator.setAttribute('aria-hidden', 'true');
  return indicator;
}

function appendInlineIndicator(html: string): string {
  if (typeof document === 'undefined') return `${html}${TYPEWRITER_INDICATOR_HTML}`;

  const template = document.createElement('template');
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_SKIP;
      if (node.parentElement?.closest('[data-stream-indicator="true"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let lastTextNode: Text | null = null;
  while (walker.nextNode()) {
    lastTextNode = walker.currentNode as Text;
  }

  const indicator = createTypewriterIndicator();
  if (lastTextNode?.parentNode) {
    const parentElement =
      lastTextNode.parentElement ?? lastTextNode.parentNode.parentElement;
    const isPreformatted = !!parentElement?.closest('pre');
    const text = lastTextNode.nodeValue ?? '';
    const trailingWhitespace = isPreformatted ? text.match(/\s+$/)?.[0] : undefined;

    if (trailingWhitespace) {
      lastTextNode.nodeValue = text.slice(0, -trailingWhitespace.length);
      lastTextNode.parentNode.insertBefore(indicator, lastTextNode.nextSibling);
      lastTextNode.parentNode.insertBefore(
        document.createTextNode(trailingWhitespace),
        indicator.nextSibling,
      );
    } else {
      lastTextNode.parentNode.insertBefore(indicator, lastTextNode.nextSibling);
    }
  } else {
    template.content.appendChild(indicator);
  }

  return template.innerHTML;
}

function renderMarkdown(content: string): string {
  if (!content) return '';
  if (!md4wReady) {
    return `<pre class="markdown-fallback">${escapeHtml(content)}</pre>`;
  }
  try {
    const rawHtml = mdToHtml(content, { parseFlags: [...MD4W_PARSE_FLAGS] });
    return scrubGeneratedUrls(restoreSafeDetails(renderMd4wMath(rawHtml)));
  } catch (error) {
    console.warn('md4w render failed; falling back to plain text.', error);
    return `<pre class="markdown-fallback">${escapeHtml(content)}</pre>`;
  }
}

function SuspendingMarkdown({
  content,
  fontSize,
  trimLast,
  showCursor,
}: {
  content: string;
  fontSize: string;
  trimLast: boolean;
  showCursor: boolean;
}) {
  if (!md4wReady) use(ensureMd4w());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastContentRef = useRef<string | null>(null);
  const lastShowCursorRef = useRef<boolean | null>(null);
  const lastHtmlRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (content === lastContentRef.current && showCursor === lastShowCursorRef.current) {
      return;
    }

    const applyContent = () => {
      const source = showCursor ? preprocessPartialMarkdown(content) : content;
      const baseHtml = renderMarkdown(source);
      const html = showCursor ? appendInlineIndicator(baseHtml) : baseHtml;
      if (html !== lastHtmlRef.current) {
        if (lastHtmlRef.current === null) {
          root.innerHTML = html;
        } else {
          Idiomorph.morph(root, html, { morphStyle: 'innerHTML' });
        }
        lastHtmlRef.current = html;
      }
      lastContentRef.current = content;
      lastShowCursorRef.current = showCursor;
      frameRef.current = null;
    };

    if (lastHtmlRef.current === null) {
      applyContent();
      return;
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(applyContent);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [content, showCursor]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('.markdown-code-copy');
      if (!button || !root.contains(button)) return;

      const code = button.closest('.markdown-code-block')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(code);
      button.dataset.copied = 'true';
      window.setTimeout(() => {
        delete button.dataset.copied;
      }, 2000);
    };

    root.addEventListener('click', handleClick);
    return () => root.removeEventListener('click', handleClick);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        'markdown-content prose prose-neutral dark:prose-invert max-w-none',
        trimLast && 'markdown-trim-last'
      )}
      style={{ fontSize }}
    />
  );
}

function MarkdownRendererInner({
  content,
  fontSize = '1rem',
  trimLast = false,
  showCursor = false,
}: {
  content: string;
  fontSize?: string;
  trimLast?: boolean;
  showCursor?: boolean;
}) {
  return (
    <SuspendingMarkdown
      content={content}
      fontSize={fontSize}
      trimLast={trimLast}
      showCursor={showCursor}
    />
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
