/**
 * Maps file extensions to language identifiers for syntax highlighting.
 */
export function extensionToLanguage(ext?: string): string | undefined {
  if (!ext) return undefined;
  const normalized = ext.replace(/^\./, "").toLowerCase();
  switch (normalized) {
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "py":
      return "python";
    case "sh":
      return "bash";
    default:
      return normalized;
  }
}

/**
 * Infers the programming language from tool arguments.
 * Checks language/lang args first, then filename extension, then extension arg.
 */
export function inferLanguage(toolArgs: Record<string, unknown>): string {
  const fromArgs = (toolArgs.language as string) || (toolArgs.lang as string);
  if (typeof fromArgs === "string" && fromArgs.trim()) return fromArgs.trim();

  const filename = toolArgs.filename as string;
  if (typeof filename === "string" && filename.includes(".")) {
    const ext = filename.split(".").pop();
    const inferred = extensionToLanguage(ext);
    if (inferred) return inferred;
  }

  const ext = toolArgs.extension as string;
  const inferred = extensionToLanguage(typeof ext === "string" ? ext : undefined);
  return inferred || "text";
}
