import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@/lib/types/chat";
import {
  buildProviderState,
  pruneProviderState,
  removeProvider,
  reorderProviderState,
  syncModelsFromProviderState,
  upsertProvider,
} from "@/lib/hooks/use-models-stream-state";

function model(provider: string, modelId: string): ModelInfo {
  return {
    provider,
    modelId,
    displayName: modelId,
    isDefault: false,
  };
}

describe("use-models-stream-state", () => {
  it("keeps provider ordering deterministic from expectedProviders", () => {
    const state = buildProviderState([]);
    reorderProviderState(state, ["alpha", "beta"]);

    upsertProvider(state, "beta", [model("beta", "beta-1")]);
    let synced = syncModelsFromProviderState(state);
    expect(synced.map((item) => item.provider)).toEqual(["beta"]);
    expect(synced[0]?.isDefault).toBe(true);

    upsertProvider(state, "alpha", [model("alpha", "alpha-1")]);
    synced = syncModelsFromProviderState(state);

    expect(synced.map((item) => item.provider)).toEqual(["alpha", "beta"]);
    expect(synced[0]?.isDefault).toBe(true);
    expect(synced[1]?.isDefault).toBe(false);
  });

  it("removes provider models immediately when provider fails", () => {
    const state = buildProviderState([
      model("alpha", "alpha-1"),
      model("beta", "beta-1"),
    ]);

    removeProvider(state, "beta");
    const synced = syncModelsFromProviderState(state);

    expect(synced.map((item) => `${item.provider}:${item.modelId}`)).toEqual([
      "alpha:alpha-1",
    ]);
  });

  it("prunes stale cached providers that were not seen in the completed stream", () => {
    const state = buildProviderState([
      model("cached_a", "old-1"),
      model("cached_b", "old-2"),
    ]);
    reorderProviderState(state, ["live_a", "cached_a"]);

    upsertProvider(state, "live_a", [model("live_a", "new-1")]);
    const expectedProviders = new Set(["live_a", "cached_a"]);
    const seenProviders = new Set(["live_a"]);

    pruneProviderState(state, expectedProviders, seenProviders);
    const synced = syncModelsFromProviderState(state);

    expect(synced.map((item) => `${item.provider}:${item.modelId}`)).toEqual([
      "live_a:new-1",
    ]);
  });
});
