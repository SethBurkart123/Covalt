import type { UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { VariableSpec } from "@nodes/_variables";
import { ROOT_CONTAINER } from "./shared";

export interface ContainerMap {
  order: string[];
  items: Record<string, string[]>;
}

export function buildContainerMap(
  specs: VariableSpec[],
  knownFolderOrder: string[],
): ContainerMap {
  const items: Record<string, string[]> = { [ROOT_CONTAINER]: [] };
  const folderOrder: string[] = [];
  const seen = new Set<string>();

  for (const name of knownFolderOrder) {
    if (seen.has(name)) continue;
    seen.add(name);
    folderOrder.push(name);
    items[name] = [];
  }

  for (const spec of specs) {
    const section = spec.section?.trim();
    if (!section) {
      items[ROOT_CONTAINER].push(spec.id);
      continue;
    }
    if (!seen.has(section)) {
      seen.add(section);
      folderOrder.push(section);
      items[section] = [];
    }
    items[section].push(spec.id);
  }

  return { order: [ROOT_CONTAINER, ...folderOrder], items };
}

export function flattenContainerMap(
  map: ContainerMap,
  specsById: Map<string, VariableSpec>,
): VariableSpec[] {
  const out: VariableSpec[] = [];
  for (const containerId of map.order) {
    const isRoot = containerId === ROOT_CONTAINER;
    for (const specId of map.items[containerId] ?? []) {
      const spec = specsById.get(specId);
      if (!spec) continue;
      if (isRoot) {
        const next = { ...spec };
        delete next.section;
        out.push(next);
      } else {
        out.push({ ...spec, section: containerId });
      }
    }
  }
  return out;
}

export function findFieldContainer(
  map: ContainerMap,
  specId: string,
): string | null {
  for (const containerId of map.order) {
    if (map.items[containerId]?.includes(specId)) return containerId;
  }
  return null;
}

export function targetFromOver(
  map: ContainerMap,
  overId: UniqueIdentifier,
): { containerId: string; index: number } | null {
  const id = String(overId);
  if (id === ROOT_CONTAINER) {
    return { containerId: ROOT_CONTAINER, index: map.items[ROOT_CONTAINER]?.length ?? 0 };
  }
  if (id.startsWith("folder:")) {
    const folderName = id.slice("folder:".length);
    if (!map.items[folderName]) return null;
    return { containerId: folderName, index: map.items[folderName].length };
  }
  if (id.startsWith("field:")) {
    const specId = id.slice("field:".length);
    const containerId = findFieldContainer(map, specId);
    if (!containerId) return null;
    return {
      containerId,
      index: map.items[containerId]?.indexOf(specId) ?? 0,
    };
  }
  return null;
}

export function moveField(
  map: ContainerMap,
  specId: string,
  targetContainer: string,
  targetIndex: number,
): ContainerMap {
  const sourceContainer = findFieldContainer(map, specId);
  if (!sourceContainer || !map.items[targetContainer]) return map;

  const items = Object.fromEntries(
    Object.entries(map.items).map(([key, value]) => [key, [...value]]),
  ) as Record<string, string[]>;
  const sourceItems = items[sourceContainer];
  const oldIndex = sourceItems.indexOf(specId);
  if (oldIndex < 0) return map;

  sourceItems.splice(oldIndex, 1);
  const targetItems = items[targetContainer];
  const adjustedIndex =
    sourceContainer === targetContainer && oldIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const clampedIndex = Math.max(0, Math.min(adjustedIndex, targetItems.length));
  targetItems.splice(clampedIndex, 0, specId);

  return { order: map.order, items };
}

export function reorderFolders(
  current: string[],
  from: string,
  to: string,
): string[] | null {
  const fromIdx = current.indexOf(from);
  const toIdx = current.indexOf(to);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return null;
  return arrayMove(current, fromIdx, toIdx);
}

export function syncFolderOrder(
  current: string[],
  specs: VariableSpec[],
): string[] {
  const discovered = specs
    .map((spec) => spec.section?.trim())
    .filter((section): section is string => Boolean(section));
  const next = current.filter((section) => discovered.includes(section));
  for (const section of discovered) {
    if (!next.includes(section)) next.push(section);
  }
  return arraysEqual(current, next) ? current : next;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
