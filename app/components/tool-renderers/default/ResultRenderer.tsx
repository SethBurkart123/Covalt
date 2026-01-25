"use client";

interface ResultRendererProps {
  content: string;
}

export function ResultRenderer({ content }: ResultRendererProps) {
  return (
    <pre className="w-full text-xs bg-muted p-2 rounded overflow-x-auto !mt-1 !mb-0 max-h-64 overflow-y-auto">
      <code className="!bg-transparent">
        {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
      </code>
    </pre>
  );
}
