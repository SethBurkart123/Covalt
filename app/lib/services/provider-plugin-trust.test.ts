import { describe, expect, it } from "vitest";

import {
  getProviderPluginSourceLabel,
  isLocalProviderPluginSource,
  normalizeProviderPluginTrustStatus,
} from "@/lib/services/provider-plugin-trust";

describe("provider-plugin-trust", () => {
  it("normalizes known trust status values", () => {
    expect(normalizeProviderPluginTrustStatus("verified")).toBe("verified");
    expect(normalizeProviderPluginTrustStatus("unsigned")).toBe("unsigned");
    expect(normalizeProviderPluginTrustStatus("untrusted")).toBe("untrusted");
    expect(normalizeProviderPluginTrustStatus("invalid")).toBe("invalid");
  });

  it("falls back unknown trust status values to unsigned", () => {
    expect(normalizeProviderPluginTrustStatus("mystery")).toBe("unsigned");
    expect(normalizeProviderPluginTrustStatus(undefined)).toBe("unsigned");
  });

  it("maps provider plugin source labels and local-source helper", () => {
    expect(getProviderPluginSourceLabel("source")).toBe("Store source");
    expect(getProviderPluginSourceLabel("zip")).toBe("ZIP upload");
    expect(getProviderPluginSourceLabel("local")).toBe("Local import");
    expect(getProviderPluginSourceLabel("other")).toBeNull();

    expect(isLocalProviderPluginSource("local")).toBe(true);
    expect(isLocalProviderPluginSource("zip")).toBe(false);
  });
});
