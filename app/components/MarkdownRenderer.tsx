import { memo, useMemo, Suspense, useState, isValidElement } from 'react';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import { Check, Copy } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import type { Components, ExtraProps } from 'react-markdown';

type MdProps<T extends keyof React.JSX.IntrinsicElements> = React.ComponentPropsWithoutRef<T> & ExtraProps;

const MemoizedComponents: Partial<Components> = {
  h1: ({ ...props }: MdProps<'h1'>) => <h1 className="scroll-m-20 text-[2.25em] font-extrabold tracking-tight lg:text-[2.5em]" {...props} />,
  h2: ({ ...props }: MdProps<'h2'>) => <h2 className="scroll-m-20 border-b pb-2 text-[1.875em] font-semibold tracking-tight first:mt-0" {...props} />,
  h3: ({ ...props }: MdProps<'h3'>) => <h3 className="scroll-m-20 text-[1.5em] font-semibold tracking-tight" {...props} />,
  h4: ({ ...props }: MdProps<'h4'>) => <h4 className="scroll-m-20 text-[1.25em] font-semibold tracking-tight" {...props} />,
  p: ({ ...props }: MdProps<'p'>) => <p className="leading-7 [&:not(:first-child)]:mt-6" {...props} />,
  blockquote: ({ ...props }: MdProps<'blockquote'>) => <blockquote className="mt-6 border-l-2 pl-6 italic" {...props} />,
  ul: ({ ...props }: MdProps<'ul'>) => <ul className="!my-1 list-disc pl-[1.625em]" {...props} />,
  ol: ({ ...props }: MdProps<'ol'>) => <ol className="my-6 list-decimal [&>li]:mt-2 pl-[1.625em]" {...props} />,
  table: ({ ...props }: MdProps<'table'>) => <div className="my-6 w-full overflow-y-auto"><table className="w-full rounded-lg" {...props} /></div>,
  th: ({ ...props }: MdProps<'th'>) => <th className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />,
  td: ({ ...props }: MdProps<'td'>) => <td className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />,
  a: ({ ...props }: MdProps<'a'>) => <a className="font-medium text-primary underline underline-offset-4" target="_blank" {...props} />,
  pre: ({ ...props }: MdProps<'pre'>) => <pre {...props} />,
  img: ({ ...props }: MdProps<'img'>) => <img className="w-full h-auto rounded-lg max-h-[500px] object-contain" {...props} />,
  hr: ({ ...props }: MdProps<'hr'>) => <hr className="!my-8" {...props} />,
  input: ({ type, checked, className, ...props }: MdProps<'input'>) => {
    if (type === 'checkbox') {
      return <Checkbox checked={!!checked} className={`mr-2 ${className}`} disabled />;
    }
    return <input type={type} className={className} {...props} />;
  },
};

interface HighlightRenderProps {
  className: string;
  style: React.CSSProperties;
  tokens: Array<Array<{ types: string[]; content: string; empty?: boolean }>>;
  getLineProps: (props: { line: Array<{ types: string[]; content: string }> }) => React.HTMLAttributes<HTMLDivElement>;
  getTokenProps: (props: { token: { types: string[]; content: string } }) => React.HTMLAttributes<HTMLSpanElement>;
}

const CodeBlock = memo(function CodeBlock({ children }: MdProps<'pre'>) {
  const [copied, setCopied] = useState(false);
  const resolvedTheme = useResolvedTheme();
  
  if (!isValidElement(children)) {
    return <pre>{children}</pre>;
  }
  
  const codeElement = children as ReactElement<{ children?: string; className?: string }>;
  
  const codeString = String(codeElement.props.children || '').replace(/\n$/, '');
  const language = /language-(\w+)/.exec(codeElement.props.className || '')?.[1] ?? 'text';
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group/code not-prose">
      <div className="h-[calc(100%-1rem)] absolute top-2 right-2 pointer-events-none">
        <button
          onClick={copyToClipboard}
          className="sticky right-2 top-4 backdrop-blur-md p-1.5 pointer-events-auto rounded-md flex justify-center text-sm items-center gap-2 bg-muted hover:bg-muted/80 dark:bg-white/5 dark:hover:bg-white/4 transition opacity-0 group-hover/code:opacity-100 z-10"
          title="Copy code"
        >
          {copied ? (<Check size={16} />) : (<Copy size={16} />)}
        </button>
      </div>
      <Suspense fallback={
        <pre style={{
          color: 'var(--tw-prose-code)',
          background: 'var(--tw-prose-pre-bg)',
          margin: '0px',
          padding: '1rem',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
        }}>
          <code>{codeString}</code>
        </pre>
      }>
        <Highlight
          theme={resolvedTheme === 'dark' ? themes.gruvboxMaterialDark : themes.gruvboxMaterialLight}
          code={codeString}
          language={language}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }: HighlightRenderProps) => (
            <pre className={className} style={{
              ...style,
              margin: 0,
              padding: '1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem'
            }}>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </Suspense>
    </div>
  );
});

const InlineCode = memo(function InlineCode({ children, ...props }: MdProps<'code'>) {
  return (
    <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-[0.875em] font-semibold" {...props}>
      {children}
    </code>
  );
});

function MarkdownRendererInner({ 
  content, 
  fontSize = "1rem",
}: { 
  content: string;
  fontSize?: string;
}) {
  const components: Partial<Components> = useMemo(() => ({
    ...MemoizedComponents,
    pre: CodeBlock,
    code: InlineCode,
  }), []);
  
  return (
    <div 
      className="prose prose-neutral dark:prose-invert max-w-none"
      style={{ fontSize }}
    >
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]} 
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);