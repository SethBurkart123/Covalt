export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
}

export type FieldId = "apiKey" | "baseUrl";

export interface ProviderFieldDef {
  id: FieldId;
  label: string;
  type: "password" | "text";
  placeholder?: string;
  required?: boolean;
}

export interface ProviderDefinition {
  key: string;
  provider: string;
  aliases?: string[];
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  fields: ProviderFieldDef[];
  defaults?: { baseUrl?: string };
  authType?: "apiKey" | "oauth";
  oauth?: {
    enterpriseDomain?: boolean;
    variant?: "panel" | "compact" | "inline-code" | "device";
  };
}

export interface ProviderCatalogItem {
  key: string;
  provider: string;
  aliases?: string[];
  name: string;
  description: string;
  icon: string;
  authType: "apiKey" | "oauth";
  defaultBaseUrl?: string | null;
  oauthVariant?: "panel" | "compact" | "inline-code" | "device" | null;
  oauthEnterpriseDomain: boolean;
  fieldMode?: "standard_api_key" | "openai_compatible" | "local_ollama" | "local_vllm" | null;
}

export interface ProviderCatalogResponse {
  providers: ProviderCatalogItem[];
}
