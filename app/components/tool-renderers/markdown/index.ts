import type { RendererDefinition } from "@/lib/tool-renderers/types";

export const markdownRenderer: RendererDefinition = {
  key: "document",
  aliases: ["document", "markdown"],
  load: () =>
    import("./MarkdownArtifact").then((module) => ({
      default: module.MarkdownArtifact,
    })),
};
