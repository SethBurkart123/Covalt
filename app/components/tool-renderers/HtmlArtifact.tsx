import { Code2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

function buildHtml(html: string): string {
  const trimmed = html.trim();
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);
  const hasDoctype = /<!doctype\s+html>/i.test(trimmed);

  if (hasHtmlTag || hasDoctype) return trimmed;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
${trimmed}
  </body>
</html>`;
}

function HtmlArtifactContent({ html }: { html: string }) {
  const htmlContent = buildHtml(html);
  const blobUrl = URL.createObjectURL(new Blob([htmlContent], { type: "text/html" }));
  return <iframe src={blobUrl} className="w-full h-full flex-1" style={{ height: "75vh" }} referrerPolicy="no-referrer" title="HTML Artifact" />;
}

export function HtmlArtifact({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
}: ToolCallRendererProps) {
  const { open } = useArtifactPanel();

  const title = (toolArgs.title as string) || toolName;
  const id = toolCallId || `${toolName}-${title}`;

  const html = typeof toolResult === "string" && toolResult.length > 0
    ? toolResult
    : (toolArgs.html as string) || "";

  const handleClick = () => {
    if (!isCompleted || !html) return;
    open(id, title, <HtmlArtifactContent html={html} />);
  };

  return (
    <Collapsible
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={!isCompleted}
      disableToggle
      data-toolcall
    >
      <CollapsibleTrigger onClick={handleClick}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Code2} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {!isCompleted && (
            <span className="text-xs text-muted-foreground">generating...</span>
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
