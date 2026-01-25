import type { RendererDefinition } from "@/lib/tool-renderers/types";
import { HtmlArtifact } from "./HtmlArtifact";

export const htmlRenderer: RendererDefinition = {
  key: "html",
  component: HtmlArtifact,
};
