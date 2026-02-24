import type { RendererDefinition } from "@/lib/tool-renderers/types";
import { FrameArtifact } from "./FrameArtifact";

export const frameRenderer: RendererDefinition = {
  key: "frame",
  component: FrameArtifact,
};
