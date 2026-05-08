"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VariableSpec } from "@nodes/_variables";
import {
  ROOT_CONTAINER,
  makeEmptySpec,
  readSpecs,
} from "./shared";
import {
  type ContainerMap,
  buildContainerMap,
  flattenContainerMap,
  syncFolderOrder,
} from "./dnd";

export interface FolderView {
  name: string;
  specs: VariableSpec[];
}

export interface VariablesEditorState {
  specs: VariableSpec[];
  specsById: Map<string, VariableSpec>;
  rootItems: VariableSpec[];
  folders: FolderView[];
  expandedIds: Set<string>;
  closedFolders: Set<string>;
  folderOrder: string[];
  folderOrderRef: React.MutableRefObject<string[]>;
  map: ContainerMap;
  toggleExpanded: (id: string) => void;
  toggleFolder: (name: string) => void;
  addSpec: (folderName?: string) => void;
  removeSpec: (specId: string) => void;
  updateSpec: (specId: string, mutator: (spec: VariableSpec) => VariableSpec) => void;
  renameFolder: (oldName: string, newName: string) => void;
  removeFolder: (name: string, keepFields: boolean) => void;
  addFolder: () => void;
  applyMap: (next: ContainerMap) => void;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setClosedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useVariablesEditorState(
  value: unknown,
  onChange: (specs: VariableSpec[]) => void,
): VariablesEditorState {
  const specs = useMemo(() => readSpecs(value), [value]);
  const specsById = useMemo(
    () => new Map(specs.map((spec) => [spec.id, spec])),
    [specs],
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [folderOrder, setFolderOrder] = useState<string[]>([]);
  const folderOrderRef = useRef(folderOrder);

  useEffect(() => {
    folderOrderRef.current = folderOrder;
  }, [folderOrder]);

  useEffect(() => {
    setFolderOrder((current) => syncFolderOrder(current, specs));
  }, [specs]);

  const map = useMemo(
    () => buildContainerMap(specs, folderOrder),
    [specs, folderOrder],
  );

  const rootItems = useMemo(
    () =>
      (map.items[ROOT_CONTAINER] ?? [])
        .map((id) => specsById.get(id))
        .filter((spec): spec is VariableSpec => Boolean(spec)),
    [map, specsById],
  );

  const folders = useMemo<FolderView[]>(
    () =>
      folderOrder.map((name) => ({
        name,
        specs: (map.items[name] ?? [])
          .map((id) => specsById.get(id))
          .filter((spec): spec is VariableSpec => Boolean(spec)),
      })),
    [folderOrder, map, specsById],
  );

  const applyMap = useCallback(
    (next: ContainerMap) => {
      setFolderOrder(next.order.filter((c) => c !== ROOT_CONTAINER));
      onChange(flattenContainerMap(next, specsById));
    },
    [onChange, specsById],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => toggleSet(prev, id));
  }, []);

  const toggleFolder = useCallback((name: string) => {
    setClosedFolders((prev) => toggleSet(prev, name));
  }, []);

  const addSpec = useCallback(
    (folderName?: string) => {
      const spec = makeEmptySpec(specs, folderName);
      onChange([...specs, spec]);
      if (folderName && !folderOrderRef.current.includes(folderName)) {
        setFolderOrder([...folderOrderRef.current, folderName]);
      }
      if (folderName) {
        setClosedFolders((prev) => removeFromSet(prev, folderName));
      }
      setExpandedIds((prev) => new Set(prev).add(spec.id));
    },
    [specs, onChange],
  );

  const removeSpec = useCallback(
    (specId: string) => {
      onChange(specs.filter((spec) => spec.id !== specId));
    },
    [specs, onChange],
  );

  const updateSpec = useCallback(
    (specId: string, mutator: (spec: VariableSpec) => VariableSpec) => {
      onChange(specs.map((spec) => (spec.id === specId ? mutator(spec) : spec)));
    },
    [specs, onChange],
  );

  const renameFolder = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      if (folderOrderRef.current.includes(trimmed)) return;
      const next = specs.map((spec) =>
        spec.section?.trim() === oldName ? { ...spec, section: trimmed } : spec,
      );
      setFolderOrder(
        folderOrderRef.current.map((name) => (name === oldName ? trimmed : name)),
      );
      setClosedFolders((prev) => {
        const nextClosed = new Set(prev);
        if (nextClosed.delete(oldName)) nextClosed.add(trimmed);
        return nextClosed;
      });
      onChange(next);
    },
    [specs, onChange],
  );

  const removeFolder = useCallback(
    (name: string, keepFields: boolean) => {
      const next = keepFields
        ? specs.map((spec) =>
            spec.section?.trim() === name ? { ...spec, section: undefined } : spec,
          )
        : specs.filter((spec) => spec.section?.trim() !== name);
      setFolderOrder(folderOrderRef.current.filter((folder) => folder !== name));
      setClosedFolders((prev) => removeFromSet(prev, name));
      onChange(next);
    },
    [specs, onChange],
  );

  const addFolder = useCallback(() => {
    const name = uniqueFolderName(folderOrderRef.current);
    const seed = makeEmptySpec(specs, name);
    onChange([...specs, seed]);
    setFolderOrder([...folderOrderRef.current, name]);
    setClosedFolders((prev) => removeFromSet(prev, name));
    setExpandedIds((prev) => new Set(prev).add(seed.id));
  }, [specs, onChange]);

  return {
    specs,
    specsById,
    rootItems,
    folders,
    expandedIds,
    closedFolders,
    folderOrder,
    folderOrderRef,
    map,
    toggleExpanded,
    toggleFolder,
    addSpec,
    removeSpec,
    updateSpec,
    renameFolder,
    removeFolder,
    addFolder,
    applyMap,
    setExpandedIds,
    setClosedFolders,
  };
}

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function removeFromSet<T>(prev: Set<T>, value: T): Set<T> {
  if (!prev.has(value)) return prev;
  const next = new Set(prev);
  next.delete(value);
  return next;
}

function uniqueFolderName(existing: string[]): string {
  const taken = new Set(existing);
  let name = "New Folder";
  let suffix = 1;
  while (taken.has(name)) {
    suffix += 1;
    name = `New Folder ${suffix}`;
  }
  return name;
}
