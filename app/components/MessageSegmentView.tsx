
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useLazyMessageRenderer } from "@/lib/renderers/use-lazy-message-renderer";
import type { MessageSegment } from "@/lib/renderers/parse-message-segments";

interface MessageSegmentViewProps {
  segment: MessageSegment;
  chatId?: string;
  showCursor?: boolean;
}

export function MessageSegmentView({
  segment,
  chatId,
  showCursor = false,
}: MessageSegmentViewProps) {
  if (segment.kind === "markdown") {
    if (!segment.text || segment.text.trim() === "") return null;
    return (
      <MarkdownRenderer
        content={segment.text}
        showCursor={showCursor}
      />
    );
  }
  return (
    <RendererSegment
      rendererKey={segment.rendererKey!}
      config={segment.config ?? {}}
      chatId={chatId}
    />
  );
}

function RendererSegment({
  rendererKey,
  config,
  chatId,
}: {
  rendererKey: string;
  config: Record<string, unknown>;
  chatId?: string;
}) {
  const Component = useLazyMessageRenderer(rendererKey);
  if (!Component) return null;
  return <Component config={config} chatId={chatId} />;
}
