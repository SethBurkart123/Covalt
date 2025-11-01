import React, { memo, useMemo, useEffect, useRef, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { animate, spring, stagger } from 'motion';
import { useTheme } from '@/contexts/theme-context';
import { Check, Copy } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';

// Memoized components for better performance
const MemoizedComponents = {
  h1: memo(({node, ...props}: any) => <h1 className="scroll-m-20 text-[2.25em] font-extrabold tracking-tight lg:text-[2.5em]" {...props} />),
  h2: memo(({node, ...props}: any) => <h2 className="scroll-m-20 border-b pb-2 text-[1.875em] font-semibold tracking-tight first:mt-0" {...props} />),
  h3: memo(({node, ...props}: any) => <h3 className="scroll-m-20 text-[1.5em] font-semibold tracking-tight" {...props} />),
  h4: memo(({node, ...props}: any) => <h4 className="scroll-m-20 text-[1.25em] font-semibold tracking-tight" {...props} />),
  p: memo(({node, ...props}: any) => <p className="leading-7 [&:not(:first-child)]:mt-6" {...props} />),
  blockquote: memo(({node, ...props}: any) => <blockquote className="mt-6 border-l-2 pl-6 italic" {...props} />),
  ul: memo(({node, ...props}: any) => <ul className="!my-1 ml-6 list-disc" {...props} />),
  ol: memo(({node, ...props}: any) => <ol className="my-6 ml-6 list-decimal [&>li]:mt-2" {...props} />),
  table: memo(({node, ...props}: any) => <div className="my-6 w-full overflow-y-auto"><table className="w-full rounded-lg" {...props} /></div>),
  th: memo(({node, ...props}: any) => <th className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />),
  td: memo(({node, ...props}: any) => <td className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />),
  a: memo(({node, ...props}: any) => <a className="font-medium text-primary underline underline-offset-4" {...props} />),
  pre: memo(({node, ...props}: any) => <pre {...props} />),
  img: memo(({node, ...props}: any) => <img className="w-full h-auto rounded-lg" {...props} />),
  hr: memo(({node, ...props}: any) => <hr className="!my-8" {...props} />),
  input: memo(({node, className, ...props}: any) => {
    if (props.type === 'checkbox') {
      return <input type="checkbox" className={`mr-2 ${className}`} {...props} />;
    }
    return <input className={className} {...props} />;
  }),
};

// @ts-expect-error: props never read
const CodeBlock = memo(({ node, inline, className, children, ...props }: any) => {
  const codeElement = children as React.ReactElement<{ children?: string }>;

  const [copied, setCopied] = React.useState(false);
  const { theme } = useTheme();
  
  const codeString = String(codeElement.props.children || '').replace(/\n$/, '');
  const language = /language-(\w+)/.exec(children.props.className)?.[1];
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group/code not-prose">
      <button
        onClick={copyToClipboard}
        className="absolute right-2 top-2 p-1.5 rounded-md flex justify-center text-sm items-center gap-2 bg-muted hover:bg-muted/80 dark:bg-white/2 dark:hover:bg-white/4 transition opacity-0 group-hover/code:opacity-100 z-10"
        title="Copy code"
      >
        {copied ? (<Check size={16} />) : (<Copy size={16} />)}
      </button>
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
          theme={theme === 'dark' ? themes.gruvboxMaterialDark : themes.gruvboxMaterialLight}
          code={codeString}
          language={language || 'text'}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }: any) => (
            <pre className={className} style={{
              ...style,
              margin: 0,
              padding: '1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem'
            }}>
              {tokens.map((line: any, i: number) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token: any, key: number) => (
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

const InlineCode = memo(({ node, className, children, ...props }: any) => {
  return (
    <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-[0.875em] font-semibold" {...props}>
      {children}
    </code>
  );
});

// Main Renderer Component with progressive rendering always on
export function MarkdownRenderer({ 
  content, 
  fontSize = "1rem",
  animateContent = false
}: { 
  content: string;
  fontSize?: string;
  animateContent?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoized components object
  const components = useMemo(() => ({
    ...MemoizedComponents,
    pre: CodeBlock,
    code: ({ node, ...props }: any) => {
      // Don't render InlineCode if we're inside a pre block
      const parent = node?.parent;
      if (parent?.type === 'element' && parent?.tagName === 'pre') {
        return <code {...props} />;
      }
      return <InlineCode node={node} {...props} />;
    },
  }), []);
  
  // Memoized plugins array with our progressive plugin
  const remarkPlugins = useMemo(() => [
    remarkGfm,
    remarkMath
  ], []);

  // Animation effect
  useEffect(() => {
    if (animateContent && containerRef.current) {
      // Small delay to let DOM update with new content
      if (containerRef.current) {
        // Set initial state for all direct children
        const elements = containerRef.current.querySelectorAll('.prose > *');

        // Animate them in with stagger
        animate(
          elements,
          { y: [20, 0], opacity: [0, 1] },
          { delay: stagger(0.05), type: spring, bounce: 0.17, duration: 0.55 }
        );
      }
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