import type { RendererDefinition } from "@/lib/tool-renderers/types";
import { DefaultToolCall } from "./DefaultToolCall";

export const defaultRenderer: RendererDefinition = {
  key: "default",
  component: DefaultToolCall,
};
