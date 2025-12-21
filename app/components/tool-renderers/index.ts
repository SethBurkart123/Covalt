import { registerToolCallRenderer } from "@/lib/tool-renderers/registry";
import { DefaultToolCall } from "./DefaultToolCall";
import { MarkdownArtifact } from "./MarkdownArtifact";

registerToolCallRenderer("default", DefaultToolCall);
registerToolCallRenderer("markdown", MarkdownArtifact);

export { DefaultToolCall, MarkdownArtifact };
