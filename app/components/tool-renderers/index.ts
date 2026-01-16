import { registerToolCallRenderer } from "@/lib/tool-renderers/registry";
import { DefaultToolCall } from "./DefaultToolCall";
import { MarkdownArtifact } from "./MarkdownArtifact";
import { HtmlArtifact } from "./HtmlArtifact";
import { CodeArtifact } from "./CodeArtifact";

registerToolCallRenderer("default", DefaultToolCall);
registerToolCallRenderer("markdown", MarkdownArtifact);
registerToolCallRenderer("document", MarkdownArtifact);
registerToolCallRenderer("html", HtmlArtifact);
registerToolCallRenderer("code", CodeArtifact);

export { DefaultToolCall, MarkdownArtifact, HtmlArtifact, CodeArtifact };
export { EditableCodeViewer } from "./EditableCodeViewer";
