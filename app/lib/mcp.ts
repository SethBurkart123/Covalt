import type { McpServerStatus } from "@/contexts/websocket-context";

export function buildMcpServerLabelMap(
  servers: McpServerStatus[]
): Map<string, string> {
  const counts = new Map<string, number>();
  servers.forEach((server) => {
    const baseId = server.serverId ?? server.id;
    counts.set(baseId, (counts.get(baseId) ?? 0) + 1);
  });

  const labels = new Map<string, string>();
  servers.forEach((server) => {
    const baseId = server.serverId ?? server.id;
    const isDuplicate = (counts.get(baseId) ?? 0) > 1;
    if (!isDuplicate) {
      labels.set(server.id, baseId);
      return;
    }

    const suffix = server.toolsetName || server.toolsetId || server.id;
    labels.set(server.id, `${baseId} (${suffix})`);
  });

  return labels;
}

export function getMcpServerLabel(
  server: McpServerStatus,
  labelMap: Map<string, string>
): string {
  return labelMap.get(server.id) ?? server.serverId ?? server.id;
}
