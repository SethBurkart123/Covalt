type ProviderPluginTrustStatus = "verified" | "unsigned" | "untrusted" | "invalid";
type ProviderPluginSourceClass = "official" | "community";

const TRUST_STATUSES: readonly ProviderPluginTrustStatus[] = [
  "verified",
  "unsigned",
  "untrusted",
  "invalid",
];

const SOURCE_TYPE_LABEL: Record<string, string> = {
  local: "Local import",
  zip: "ZIP upload",
  source: "Store source",
  repo: "GitHub repo",
};

export function normalizeProviderPluginTrustStatus(value: unknown): ProviderPluginTrustStatus {
  if (typeof value !== "string") return "unsigned";
  return TRUST_STATUSES.includes(value as ProviderPluginTrustStatus)
    ? (value as ProviderPluginTrustStatus)
    : "unsigned";
}

export function normalizeProviderPluginSourceClass(value: unknown): ProviderPluginSourceClass {
  return value === "official" ? "official" : "community";
}

export function getProviderPluginSourceLabel(sourceType: unknown): string | null {
  if (typeof sourceType !== "string") return null;
  return SOURCE_TYPE_LABEL[sourceType] || null;
}

export function isLocalProviderPluginSource(sourceType: unknown): boolean {
  return sourceType === "local";
}
