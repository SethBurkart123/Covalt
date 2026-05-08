"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { FolderPlus, Plus } from "lucide-react";
import type { ControlProps } from "./";
import type { VariableSpec } from "@nodes/_variables";
import { Button } from "@/components/ui/button";
import { FieldRow } from "./variables-editor/field-row";
import { FolderRow } from "./variables-editor/folder-row";
import { ROOT_CONTAINER } from "./variables-editor/shared";
import {
  type ContainerMap,
  moveField,
  reorderFolders,
  targetFromOver,
} from "./variables-editor/dnd";
import {
  DragPreviewRow,
  RootAppendZone,
  RootDropZone,
} from "./variables-editor/drop-zones";
import { useVariablesEditorState } from "./variables-editor/use-variables-editor-state";

const MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always },
};

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

export function VariablesEditor({ value, onChange }: ControlProps) {
  const state = useVariablesEditorState(
    value,
    onChange as (specs: VariableSpec[]) => void,
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const sortableIds = useMemo(
    () => buildSortableIds(state.rootItems, state.folders, state.closedFolders),
    [state.rootItems, state.folders, state.closedFolders],
  );

  const dragInfo = describeActive(activeId, state.specsById);
  const isEmpty = state.specs.length === 0 && state.folders.length === 0;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      if (id.startsWith("field:")) {
        const specId = id.slice("field:".length);
        state.setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(specId);
          return next;
        });
      } else if (id.startsWith("folder:")) {
        const folderName = id.slice("folder:".length);
        state.setClosedFolders((prev) => new Set(prev).add(folderName));
      }
      setActiveId(event.active.id);
    },
    [state],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const next = nextMapForDragEnd(event, state.map, state.folderOrderRef.current);
      if (next) state.applyMap(next);
    },
    [state],
  );

  return (
    <div className="space-y-2">
      <EditorToolbar
        onAddField={() => state.addSpec()}
        onAddFolder={state.addFolder}
      />
      {isEmpty ? (
        <EmptyHint onAdd={() => state.addSpec()} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={MEASURING}
          modifiers={MODIFIERS}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <RootDropZone>
            <div role="tree">
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                <RootFields state={state} />
                <RootAppendZone active={Boolean(dragInfo.spec)} />
                <FolderList state={state} />
              </SortableContext>
            </div>
          </RootDropZone>
          <DragOverlay
            dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
          >
            {dragInfo.spec ? (
              <DragPreviewRow
                label={dragInfo.spec.label || dragInfo.spec.id}
              />
            ) : dragInfo.folder ? (
              <DragPreviewRow label={dragInfo.folder} folder />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function EditorToolbar({
  onAddField,
  onAddFolder,
}: {
  onAddField: () => void;
  onAddFolder: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={onAddField}
        title="Add field"
      >
        <Plus className="h-3.5 w-3.5" />
        Field
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={onAddFolder}
        title="Add folder"
      >
        <FolderPlus className="h-3.5 w-3.5" />
        Folder
      </Button>
    </div>
  );
}

function EmptyHint({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="w-full rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      <Plus className="mx-auto mb-1 h-4 w-4" />
      No variables yet — click to add your first.
    </button>
  );
}

function RootFields({ state }: { state: ReturnType<typeof useVariablesEditorState> }) {
  return (
    <>
      {state.rootItems.map((spec) => (
        <FieldRow
          key={`field:${spec.id}`}
          spec={spec}
          expanded={state.expandedIds.has(spec.id)}
          onToggle={() => state.toggleExpanded(spec.id)}
          onRemove={() => state.removeSpec(spec.id)}
          onChange={(next) => state.updateSpec(spec.id, () => next)}
        />
      ))}
    </>
  );
}

function FolderList({ state }: { state: ReturnType<typeof useVariablesEditorState> }) {
  return (
    <>
      {state.folders.map((folder) => {
        const open = !state.closedFolders.has(folder.name);
        return (
          <Fragment key={`folder-group:${folder.name}`}>
            <FolderRow
              name={folder.name}
              count={folder.specs.length}
              open={open}
              onToggle={() => state.toggleFolder(folder.name)}
              onAddField={() => state.addSpec(folder.name)}
              onRename={(next) => state.renameFolder(folder.name, next)}
              onRemove={(keep) => state.removeFolder(folder.name, keep)}
            />
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden"
                >
                  {folder.specs.map((spec) => (
                    <FieldRow
                      key={`field:${spec.id}`}
                      spec={spec}
                      expanded={state.expandedIds.has(spec.id)}
                      depth={1}
                      onToggle={() => state.toggleExpanded(spec.id)}
                      onRemove={() => state.removeSpec(spec.id)}
                      onChange={(next) => state.updateSpec(spec.id, () => next)}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </Fragment>
        );
      })}
    </>
  );
}

function buildSortableIds(
  rootItems: VariableSpec[],
  folders: { name: string; specs: VariableSpec[] }[],
  closedFolders: Set<string>,
): string[] {
  return [
    ...rootItems.map((spec) => `field:${spec.id}`),
    ...folders.flatMap((folder) => [
      `folder:${folder.name}`,
      ...(closedFolders.has(folder.name)
        ? []
        : folder.specs.map((spec) => `field:${spec.id}`)),
    ]),
  ];
}

function describeActive(
  activeId: UniqueIdentifier | null,
  specsById: Map<string, VariableSpec>,
): { spec: VariableSpec | null; folder: string | null } {
  if (!activeId) return { spec: null, folder: null };
  const id = String(activeId);
  if (id.startsWith("field:")) {
    return { spec: specsById.get(id.slice("field:".length)) ?? null, folder: null };
  }
  if (id.startsWith("folder:")) {
    return { spec: null, folder: id.slice("folder:".length) };
  }
  return { spec: null, folder: null };
}

function nextMapForDragEnd(
  event: DragEndEvent,
  map: ContainerMap,
  folderOrder: string[],
): ContainerMap | null {
  const activeData = event.active.data.current as
    | { type?: string; specId?: string; folderName?: string }
    | undefined;
  const over = event.over;
  if (!over || !activeData?.type) return null;

  if (activeData.type === "folder" && activeData.folderName) {
    const overData = over.data.current as
      | { type?: string; folderName?: string }
      | undefined;
    if (overData?.type !== "folder" || !overData.folderName) return null;
    const next = reorderFolders(folderOrder, activeData.folderName, overData.folderName);
    if (!next) return null;
    return { order: [ROOT_CONTAINER, ...next], items: map.items };
  }

  if (activeData.type !== "field" || !activeData.specId) return null;
  const target = targetFromOver(map, over.id);
  if (!target) return null;
  return moveField(map, activeData.specId, target.containerId, target.index);
}
