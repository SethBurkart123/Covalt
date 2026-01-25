import type { RendererDefinition } from "@/lib/tool-renderers/types";
import { MarkdownArtifact } from "./MarkdownArtifact";

export const markdownRenderer: RendererDefinition = {
  key: "markdown",
  component: MarkdownArtifact,
};
