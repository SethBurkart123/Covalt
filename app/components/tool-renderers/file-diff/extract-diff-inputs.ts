export interface DiffInputs {
  filePath?: string;
  oldContent: string;
  newContent: string;
  isPartial: boolean;
}

const PATH_KEYS = ["filePath", "path", "file", "file_path", "filename", "target"];
const OLD_CONTENT_KEYS = ["oldContent", "old_content", "originalContent", "original"];
const NEW_CONTENT_KEYS = ["newContent", "new_content", "updatedContent", "updated"];
const OLD_STR_KEYS = ["oldStr", "old_str", "find", "search"];
const NEW_STR_KEYS = ["newStr", "new_str", "replace", "replacement"];

function pickString(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function extractDiffInputs(
  config: Record<string, unknown> | undefined,
  toolArgs: Record<string, unknown> | undefined,
): DiffInputs {
  const filePath = pickString(config, PATH_KEYS) ?? pickString(toolArgs, PATH_KEYS);

  const fullOld = pickString(config, OLD_CONTENT_KEYS) ?? pickString(toolArgs, OLD_CONTENT_KEYS);
  const fullNew = pickString(config, NEW_CONTENT_KEYS) ?? pickString(toolArgs, NEW_CONTENT_KEYS);
  if (fullOld !== undefined || fullNew !== undefined) {
    return {
      filePath,
      oldContent: fullOld ?? "",
      newContent: fullNew ?? "",
      isPartial: false,
    };
  }

  const partialOld = pickString(config, OLD_STR_KEYS) ?? pickString(toolArgs, OLD_STR_KEYS);
  const partialNew = pickString(config, NEW_STR_KEYS) ?? pickString(toolArgs, NEW_STR_KEYS);
  if (partialOld !== undefined || partialNew !== undefined) {
    return {
      filePath,
      oldContent: partialOld ?? "",
      newContent: partialNew ?? "",
      isPartial: true,
    };
  }

  return { filePath, oldContent: "", newContent: "", isPartial: false };
}
