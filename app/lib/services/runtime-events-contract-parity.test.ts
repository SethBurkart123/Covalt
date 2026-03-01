import { describe, expect, it } from "vitest";
import {
  KNOWN_RUNTIME_EVENTS,
  RUNTIME_EVENT,
  RUNTIME_EVENT_CONTRACT_VERSION,
} from "@/lib/services/runtime-events";
import runtimeEventContract from "../../../contracts/runtime-events.v1.json";

type RuntimeEventContract = {
  version: string;
  events: Array<{ key: string; name: string }>;
};

describe("runtime event contract parity", () => {
  it("keeps generated FE runtime events aligned to canonical contract", () => {
    const contract = runtimeEventContract as RuntimeEventContract;

    expect(RUNTIME_EVENT_CONTRACT_VERSION).toBe(contract.version);

    const contractNames = contract.events.map((event) => event.name);
    const frontendNames = [...KNOWN_RUNTIME_EVENTS];

    expect(frontendNames).toEqual(contractNames);

    const runtimeEventMap = Object.fromEntries(
      Object.entries(RUNTIME_EVENT).sort(([a], [b]) => a.localeCompare(b)),
    );
    const contractMap = Object.fromEntries(
      contract.events
        .map((event) => [event.key, event.name] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

    expect(runtimeEventMap).toEqual(contractMap);
  });
});
