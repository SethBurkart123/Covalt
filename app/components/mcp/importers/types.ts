export type ImportRootKey = "mcpServers" | "mcp";

export interface ImportSource {
  key: string;
  name: string;
  configPaths: {
    darwin: string[];
    win32?: string[];
    linux?: string[];
  };
  rootKey: ImportRootKey;
}
