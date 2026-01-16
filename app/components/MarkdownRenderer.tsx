import React, { memo, useMemo, useEffect, useRef, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { animate, spring, stagger } from 'motion';
import { useTheme } from '@/contexts/theme-context';
import { Check, Copy } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import type { Components } from 'react-markdown';

interface MarkdownNodeProps {
  node?: unknown;
  className?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}

const MemoizedComponents: Components = {
  h1: memo(({ className, ...props }: MarkdownNodeProps) => <h1 className="scroll-m-20 text-[2.25em] font-extrabold tracking-tight lg:text-[2.5em]" {...props} />),
  h2: memo(({ className, ...props }: MarkdownNodeProps) => <h2 className="scroll-m-20 border-b pb-2 text-[1.875em] font-semibold tracking-tight first:mt-0" {...props} />),
  h3: memo(({ className, ...props }: MarkdownNodeProps) => <h3 className="scroll-m-20 text-[1.5em] font-semibold tracking-tight" {...props} />),
  h4: memo(({ className, ...props }: MarkdownNodeProps) => <h4 className="scroll-m-20 text-[1.25em] font-semibold tracking-tight" {...props} />),
  p: memo(({ className, ...props }: MarkdownNodeProps) => <p className="leading-7 [&:not(:first-child)]:mt-6" {...props} />),
  blockquote: memo(({ className, ...props }: MarkdownNodeProps) => <blockquote className="mt-6 border-l-2 pl-6 italic" {...props} />),
  ul: memo(({ className, ...props }: MarkdownNodeProps) => <ul className="!my-1 list-disc pl-[1.625em]" {...props} />),
  ol: memo(({ className, ...props }: MarkdownNodeProps) => <ol className="my-6 list-decimal [&>li]:mt-2 pl-[1.625em]" {...props} />),
  table: memo(({ className, ...props }: MarkdownNodeProps) => <div className="my-6 w-full overflow-y-auto"><table className="w-full rounded-lg" {...props} /></div>),
  th: memo(({ className, ...props }: MarkdownNodeProps) => <th className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />),
  td: memo(({ className, ...props }: MarkdownNodeProps) => <td className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />),
  a: memo(({ className, ...props }: MarkdownNodeProps) => <a className="font-medium text-primary underline underline-offset-4" target="_blank" {...props} />),
  pre: memo(({ className, ...props }: MarkdownNodeProps) => <pre {...props} />),
  img: memo(({ className, ...props }: MarkdownNodeProps) => <img className="w-full h-auto rounded-lg max-h-[500px] object-contain" {...props} />),
  hr: memo(({ className, ...props }: MarkdownNodeProps) => <hr className="!my-8" {...props} />),
  input: memo(({ className, type, checked, ...props }: MarkdownNodeProps) => {
    if (type === 'checkbox') {
      return <Checkbox checked={!!checked} className={`mr-2 ${className || ''}`} disabled />;
    }
    return <input type={type as string} className={className} {...props} />;
  }),
};

interface CodeBlockProps {
  node?: { parent?: { type?: string; tagName?: string } };
  inline?: boolean;
  className?: string;
  children: React.ReactElement<{ children?: string; className?: string }>;
}

const CodeBlock = memo(({ node, children }: CodeBlockProps) => {
  const codeElement = children as React.ReactElement<{ children?: string }>;

  const [copied, setCopied] = React.useState(false);
  const { theme } = useTheme();
  const [systemPreference, setSystemPreference] = React.useState<"light" | "dark">(() => 
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  
  const resolvedTheme = theme === "system" ? systemPreference : theme;
  
  React.useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemPreference(mediaQuery.matches ? "dark" : "light");
    };
    
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [theme]);
  
  const codeString = String(codeElement.props.children || '').replace(/\n$/, '');
  const language = /language-(\w+)/.exec(children.props.className)?.[1];
  
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
          language={language || 'text'}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }: {
            className: string;
            style: React.CSSProperties;
            tokens: Array<Array<{ types: string[]; content: string }>>;
            getLineProps: (props: { line: Array<{ types: string[]; content: string }> }) => React.HTMLAttributes<HTMLDivElement>;
            getTokenProps: (props: { token: { types: string[]; content: string } }) => React.HTMLAttributes<HTMLSpanElement>;
          }) => (
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

const InlineCode = memo(({ className, children, ...props }: MarkdownNodeProps) => {
  return (
    <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-[0.875em] font-semibold" {...props}>
      {children}
    </code>
  );
});

function MarkdownRendererInner({ 
  content, 
  fontSize = "1rem",
  animateContent = false
}: { 
  content: string;
  fontSize?: string;
  animateContent?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const components = useMemo(() => ({
    ...MemoizedComponents,
    pre: CodeBlock,
    code: ({ node, ...props }: MarkdownNodeProps) => {
      const parent = (node as { parent?: { type?: string; tagName?: string } })?.parent;
      if (parent?.type === 'element' && parent?.tagName === 'pre') {
        return <code {...props} />;
      }
      return <InlineCode {...props} />;
    },
  }), []);
  
  const remarkPlugins = useMemo(() => [
    remarkGfm,
    remarkMath
  ], []);

  useEffect(() => {
    if (animateContent && containerRef.current) {
      const elements = containerRef.current.querySelectorAll('.prose > *');
      animate(
        elements,
        { y: [20, 0], opacity: [0, 1] },
        { delay: stagger(0.05), type: spring, bounce: 0.17, duration: 0.55 }
      );
    }
  }, [animateContent, content]);
  
  return (
    <div 
      ref={containerRef}
      className="prose prose-neutral dark:prose-invert max-w-none"
      style={{ fontSize }}
    >
      <ReactMarkdown 
        remarkPlugins={remarkPlugins} 
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);