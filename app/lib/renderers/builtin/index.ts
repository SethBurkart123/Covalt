import { registerRenderer, type RendererDefinition } from "../registry";
import { matchSystemReminder } from "./system-reminder";
import { matchJsonRender } from "./json-render";

let registered = false;

const BUILTIN_MESSAGE_DEFINITIONS: RendererDefinition[] = [
  {
    key: "system-reminder",
    matchMessage: matchSystemReminder,
    message: () => import("./system-reminder"),
  },
  {
    key: "json-render",
    matchMessage: matchJsonRender,
    message: () => import("../json-render/JsonRenderMessage"),
  },
];

export function registerBuiltinMessageRenderers(): void {
  if (registered) return;
  registered = true;
  for (const def of BUILTIN_MESSAGE_DEFINITIONS) {
    registerRenderer(def);
  }
}
