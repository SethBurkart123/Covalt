export type ProviderPluginTrustStatus = "verified" | "unsigned" | "untrusted" | "invalid";

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

export function normalizeProviderPluginTrustStatus(value: unknown): ProviderPluginTrustStatus {
  if (typeof value !== "string") return "unsigned";
  return TRUST_STATUSES.includes(value as ProviderPluginTrustStatus)
    ? (value as ProviderPluginTrustStatus)
    : "unsigned";
}

export function getProviderPluginSourceLabel(sourceType: unknown): string | null {
  if (typeof sourceType !== "string") return null;
  return SOURCE_TYPE_LABEL[sourceType] || null;
}

export function isLocalProviderPluginSource(sourceType: unknown): boolean {
  return sourceType === "local";
}
