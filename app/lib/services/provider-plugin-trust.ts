export type ProviderPluginTrustStatus = "verified" | "unsigned" | "untrusted" | "invalid";
export type ProviderPluginSourceClass = "official" | "community";

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

export const TRUST_BADGE_STYLE: Record<ProviderPluginTrustStatus, string> = {
  verified: "text-green-600",
  unsigned: "text-amber-600",
  untrusted: "text-amber-600",
  invalid: "text-red-600",
};

export const TRUST_BADGE_LABEL: Record<ProviderPluginTrustStatus, string> = {
  verified: "Verified",
  unsigned: "Unsigned",
  untrusted: "Untrusted signer",
  invalid: "Invalid signature",
};

export const SOURCE_CLASS_BADGE_STYLE: Record<ProviderPluginSourceClass, string> = {
  official: "text-green-600",
  community: "text-amber-600",
};

export const SOURCE_CLASS_BADGE_LABEL: Record<ProviderPluginSourceClass, string> = {
  official: "Official",
  community: "Community",
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
