import type { RendererDefinition } from "@/lib/tool-renderers/types";
import { CodeArtifact } from "./CodeArtifact";

export const codeRenderer: RendererDefinition = {
  key: "code",
  component: CodeArtifact,
};
