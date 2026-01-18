import { Code2, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

function buildHtml(html: string, data?: unknown): string {
  const trimmed = html.trim();
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);
  const hasDoctype = /<!doctype\s+html>/i.test(trimmed);

  const dataScript = data !== undefined
    ? `<script>window.__TOOL_DATA__ = ${JSON.stringify(data)};</script>\n`
    : "";

  if (hasHtmlTag || hasDoctype) {
    if (/<\/head>/i.test(trimmed)) {
      return trimmed.replace(/<\/head>/i, `${dataScript}</head>`);
    } else if (/<body[^>]*>/i.test(trimmed)) {
      return trimmed.replace(/(<body[^>]*>)/i, `$1\n${dataScript}`);
    }
    return trimmed;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${dataScript}
  </head>
  <body>
${trimmed}
  </body>
</html>`;
}

function HtmlArtifactContent({ html, data }: { html: string; data?: unknown }) {
  const blobUrl = URL.createObjectURL(new Blob([buildHtml(html, data)], { type: "text/html" }));
  return (
    <iframe 
      src={blobUrl} 
      className="w-full h-full flex-1" 
      style={{ height: "75vh" }} 
      referrerPolicy="no-referrer" 
      title="HTML Artifact"
      sandbox="allow-scripts allow-same-origin"
    />
  );
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
  renderPlan,
}: ToolCallRendererProps) {
  const { open } = useArtifactPanel();

  const title = (toolArgs.title as string) || toolName;

  const html = typeof renderPlan?.config?.content === "string" && renderPlan.config.content.length > 0
    ? renderPlan.config.content
    : typeof toolResult === "string" && toolResult.length > 0
      ? toolResult
      : (toolArgs.html as string) || "";

  const handleClick = () => {
    if (!isCompleted || !html) return;
    open(
      toolCallId || `${toolName}-${title}`,
      title,
      <HtmlArtifactContent html={html} data={renderPlan?.config?.data} />
    );
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
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
