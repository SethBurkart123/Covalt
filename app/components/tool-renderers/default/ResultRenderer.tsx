"use client";

interface ResultRendererProps {
  content: string;
  tone?: "default" | "error";
}

export function ResultRenderer({ content, tone = "default" }: ResultRendererProps) {
  const isError = tone === "error";

  return (
    <pre
      className={`w-full text-xs p-2 rounded overflow-x-auto !mt-1 !mb-0 max-h-64 overflow-y-auto ${
        isError
          ? "bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30"
          : "bg-muted"
      }`}
    >
      <code className="!bg-transparent">{content}</code>
    </pre>
  );
}
