import type { KeyValuePair } from "@/components/ui/key-value-input";

export type ServerType = "stdio" | "sse" | "streamable-http";

export interface ServerFormData {
  id: string;
  type: ServerType;
  command: string;
  cwd: string;
  url: string;
  env: KeyValuePair[];
  headers: string;
  requiresConfirmation: boolean;
}

export const emptyFormData: ServerFormData = {
  id: "",
  type: "stdio",
  command: "",
  cwd: "",
  url: "",
  env: [],
  headers: "",
  requiresConfirmation: true,
};
