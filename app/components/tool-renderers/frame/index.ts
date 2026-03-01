import type { RendererDefinition } from "@/lib/tool-renderers/types";

export const frameRenderer: RendererDefinition = {
  key: "frame",
  aliases: ["frame"],
  load: () =>
    import("./FrameArtifact").then((module) => ({
      default: module.FrameArtifact,
    })),
};
