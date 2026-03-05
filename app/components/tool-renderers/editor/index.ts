import type { RendererDefinition } from "@/lib/tool-renderers/types";

export const editorRenderer: RendererDefinition = {
  key: "editor",
  aliases: ["editor"],
  load: () =>
    import("./FileEditorArtifact").then((module) => ({
      default: module.FileEditorArtifact,
    })),
};
