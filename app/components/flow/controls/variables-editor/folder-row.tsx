
import { useState, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FolderRowProps {
  name: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onAddField: () => void;
  onRename: (newName: string) => void;
  onRemove: (keepFields: boolean) => void;
}

export function FolderRow(props: FolderRowProps) {
  const { name, open, onToggle } = props;
  const [editing, setEditing] = useState(false);
  const sortable = useSortable({
    id: `folder:${name}`,
    data: { type: "folder", folderName: name },
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "group/folder relative",
        sortable.isDragging && "opacity-40",
      )}
    >
      <div
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        aria-selected={false}
        className="flex items-center gap-1 h-7 pl-1 pr-1.5 transition-colors hover:bg-accent/40 cursor-pointer"
        onClick={() => {
          if (!editing) onToggle();
        }}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/70 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <FolderDragHandle sortable={sortable} />
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <FolderName
          name={name}
          editing={editing}
          onStartEdit={() => setEditing(true)}
          onCommit={(next) => {
            setEditing(false);
            if (next !== name) props.onRename(next);
          }}
        />
        <FolderActions
          {...props}
          onStartEdit={() => setEditing(true)}
        />
      </div>
    </div>
  );
}

function FolderDragHandle({
  sortable,
}: {
  sortable: ReturnType<typeof useSortable>;
}) {
  return (
    <button
      type="button"
      className="h-5 w-4 flex items-center justify-center text-muted-foreground/0 group-hover/folder:text-muted-foreground/60 hover:!text-foreground cursor-grab active:cursor-grabbing shrink-0 transition-colors"
      onClick={(event) => event.stopPropagation()}
      {...sortable.attributes}
      {...sortable.listeners}
      title="Drag folder"
    >
      <GripVertical className="h-3 w-3" />
    </button>
  );
}

function FolderName({
  name,
  editing,
  onStartEdit,
  onCommit,
}: {
  name: string;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (next: string) => void;
}) {
  if (editing) return <FolderNameInput name={name} onCommit={onCommit} />;
  return (
    <span
      className="text-xs font-medium truncate flex-1 min-w-0"
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
    >
      {name}
    </span>
  );
}

function FolderNameInput({
  name,
  onCommit,
}: {
  name: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <Input
      autoFocus
      value={draft}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim() || name)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(name);
          onCommit(name);
        }
      }}
      className="h-5 text-xs px-1 py-0 flex-1 min-w-0"
    />
  );
}

function FolderActions({
  count,
  onAddField,
  onRemove,
  onStartEdit,
}: FolderRowProps & { onStartEdit: () => void }) {
  return (
    <>
      <span className="text-[10px] text-muted-foreground/70 shrink-0">
        {count}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 opacity-0 group-hover/folder:opacity-100 transition-opacity"
        onClick={(event) => {
          event.stopPropagation();
          onAddField();
        }}
        title="Add field"
      >
        <Plus className="h-3 w-3" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 opacity-0 group-hover/folder:opacity-100 transition-opacity"
            onClick={(event) => event.stopPropagation()}
            title="Folder options"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onStartEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          {count > 0 && (
            <DropdownMenuItem onSelect={() => onRemove(true)}>
              <FolderOpen className="mr-2 h-3.5 w-3.5" />
              Ungroup (keep fields)
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onRemove(false)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete folder{count > 0 ? " & fields" : ""}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
