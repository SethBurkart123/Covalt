import type { RendererDefinition } from "@/lib/tool-renderers/types";

export const codeRenderer: RendererDefinition = {
  key: "code",
  aliases: ["code"],
  load: () =>
    import("./CodeArtifact").then((module) => ({
      default: module.CodeArtifact,
    })),
};
