"use client";

import React from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

export type ToolResultRenderer = React.ComponentType<{ content: string }>;

function DefaultRenderer({ content }: { content: string }) {
  return (
    <pre className="w-full text-xs bg-muted p-2 rounded overflow-x-auto !mt-1 !mb-0 max-h-64 overflow-y-auto">
      <code className="!bg-transparent">
        {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
      </code>
    </pre>
  );
}

function MarkdownResultRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <MarkdownRenderer content={content} />
    </div>
  );
}

const renderers: Record<string, ToolResultRenderer> = {
  markdown: MarkdownResultRenderer,
};

export function getToolResultRenderer(renderer?: string): ToolResultRenderer {
  if (renderer && renderer in renderers) {
    return renderers[renderer];
  }
  return DefaultRenderer;
}

export function registerToolResultRenderer(name: string, component: ToolResultRenderer) {
  renderers[name] = component;
}
