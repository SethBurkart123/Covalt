import type { RendererDefinition } from "@/lib/tool-renderers/types";

export const defaultRenderer: RendererDefinition = {
  key: "default",
  aliases: ["default"],
  load: () =>
    import("./DefaultToolCall").then((module) => ({
      default: module.DefaultToolCall,
    })),
};
