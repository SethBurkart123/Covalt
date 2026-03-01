import type { RendererDefinition } from "@/lib/tool-renderers/types";

export const htmlRenderer: RendererDefinition = {
  key: "html",
  aliases: ["html"],
  load: () =>
    import("./HtmlArtifact").then((module) => ({
      default: module.HtmlArtifact,
    })),
};
