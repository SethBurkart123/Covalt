const EXTENSION_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  xml: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "docker",
};

const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
};

export function detectLanguage(path: string, override?: string): string {
  if (override && override.length > 0) return override;
  const lastSeg = path.split("/").pop() ?? path;
  const lower = lastSeg.toLowerCase();
  const byName = FILENAME_TO_LANG[lower];
  if (byName) return byName;
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lower.length - 1) return "plaintext";
  const ext = lower.slice(dotIndex + 1);
  return EXTENSION_TO_LANG[ext] ?? "plaintext";
}
