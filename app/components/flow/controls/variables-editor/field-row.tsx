"use client";

import type { CSSProperties } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Trash2,
  GripVertical,
  MoreHorizontal,
  ChevronRight,
  Info,
} from "lucide-react";
import type { ControlKindId, VariableSpec } from "@nodes/_variables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CONTROL_KIND_LABELS,
  FieldLabel,
  SELECTABLE_KINDS,
  switchControlKind,
} from "./shared";
import { ControlSpecificFields } from "./control-specific-fields";
import { OptionsSourceFields } from "./options-source-fields";

interface FieldRowProps {
  spec: VariableSpec;
  expanded: boolean;
  depth?: number;
  onToggle: () => void;
  onRemove: () => void;
  onChange: (spec: VariableSpec) => void;
}

const INDENT_PX = 16;

export function FieldRow({
  spec,
  expanded,
  depth = 0,
  onToggle,
  onRemove,
  onChange,
}: FieldRowProps) {
  const isContributed = Boolean(spec.contributed_by);
  const sortable = useSortable({
    id: `field:${spec.id}`,
    data: { type: "field", specId: spec.id },
    disabled: isContributed,
    animateLayoutChanges: () => true,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
  const indentPx = depth * INDENT_PX;

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn("group relative", sortable.isDragging && "opacity-30")}
    >
      <FieldRowHeader
        spec={spec}
        expanded={expanded}
        depth={depth}
        indentPx={indentPx}
        isContributed={isContributed}
        sortable={sortable}
        onToggle={onToggle}
        onRemove={onRemove}
      />
      <AnimatePresence initial={false}>
        {expanded && !isContributed && (
          <FieldRowBody indentPx={indentPx} spec={spec} onChange={onChange} />
        )}
      </AnimatePresence>
    </div>
  );
}

interface FieldRowHeaderProps {
  spec: VariableSpec;
  expanded: boolean;
  depth: number;
  indentPx: number;
  isContributed: boolean;
  sortable: ReturnType<typeof useSortable>;
  onToggle: () => void;
  onRemove: () => void;
}

function FieldRowHeader({
  spec,
  expanded,
  depth,
  indentPx,
  isContributed,
  sortable,
  onToggle,
  onRemove,
}: FieldRowHeaderProps) {
  const controlLabel = CONTROL_KIND_LABELS[spec.control.kind];
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expanded}
      aria-selected={false}
      className={cn(
        "flex items-center gap-1 h-7 pr-1.5 transition-colors relative",
        !isContributed && "hover:bg-accent/40 cursor-pointer",
      )}
      style={{ paddingLeft: indentPx + 4 }}
      onClick={isContributed ? undefined : onToggle}
    >
      <ChevronRight
        className={cn(
          "h-3 w-3 text-muted-foreground/70 shrink-0 transition-transform",
          expanded && "rotate-90",
          isContributed && "invisible",
        )}
      />
      <FieldDragHandle sortable={sortable} disabled={isContributed} />
      <span className="text-xs font-medium truncate flex-1 min-w-0">
        {spec.label || spec.id || "Untitled"}
      </span>
      {isContributed && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          From {spec.contributed_by}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground/80 rounded-sm px-1.5 py-0.5 bg-muted/50 shrink-0 leading-none">
        {controlLabel}
      </span>
      {!isContributed && <FieldOptionsMenu onRemove={onRemove} />}
    </div>
  );
}

function FieldDragHandle({
  sortable,
  disabled,
}: {
  sortable: ReturnType<typeof useSortable>;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-5 w-4 flex items-center justify-center text-muted-foreground/0 group-hover:text-muted-foreground/60 shrink-0 transition-colors",
        !disabled &&
          "cursor-grab active:cursor-grabbing hover:!text-foreground",
      )}
      onClick={(e) => e.stopPropagation()}
      {...(disabled ? {} : sortable.attributes)}
      {...(disabled ? {} : sortable.listeners)}
      title={disabled ? "Contributed" : "Drag to reorder"}
    >
      <GripVertical className="h-3 w-3" />
    </button>
  );
}

function FieldOptionsMenu({ onRemove }: { onRemove: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          title="Field options"
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FieldRowBodyProps {
  spec: VariableSpec;
  indentPx: number;
  onChange: (spec: VariableSpec) => void;
}

function FieldRowBody({ spec, indentPx, onChange }: FieldRowBodyProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="overflow-hidden"
    >
      <div
        className="space-y-2 py-2 pr-2"
        style={{ paddingLeft: indentPx + 24 }}
      >
        <FieldLabelAndControl spec={spec} onChange={onChange} />
        <ControlSpecificFields spec={spec} onChange={onChange} />
        {SELECTABLE_KINDS.has(spec.control.kind) && (
          <OptionsSourceFields spec={spec} onChange={onChange} />
        )}
        <FieldFlags spec={spec} onChange={onChange} />
      </div>
    </motion.div>
  );
}

function FieldLabelAndControl({
  spec,
  onChange,
}: {
  spec: VariableSpec;
  onChange: (spec: VariableSpec) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
      <FieldLabel label="Label">
        <Input
          value={spec.label}
          onChange={(e) => onChange({ ...spec, label: e.target.value })}
          placeholder="My Variable"
          className="h-8 text-xs"
        />
      </FieldLabel>
      <FieldLabel label="Control">
        <Select
          value={spec.control.kind}
          onValueChange={(value) =>
            onChange(switchControlKind(spec, value as ControlKindId))
          }
        >
          <SelectTrigger size="sm" className="text-xs min-w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CONTROL_KIND_LABELS).map(([kind, label]) => (
              <SelectItem key={kind} value={kind}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldLabel>
    </div>
  );
}

function FieldFlags({
  spec,
  onChange,
}: {
  spec: VariableSpec;
  onChange: (spec: VariableSpec) => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-4 pt-1">
        <FlagToggle
          checked={spec.placement === "advanced"}
          onCheckedChange={(checked) =>
            onChange({ ...spec, placement: checked ? "advanced" : "header" })
          }
          label="Advanced"
          help='When on, this field is hidden behind the "Advanced" popover in the chat input. When off, it sits inline next to the model picker.'
        />
        <FlagToggle
          checked={Boolean(spec.required)}
          onCheckedChange={(checked) => onChange({ ...spec, required: checked })}
          label="Required"
          help="When on, the user must provide a value before sending."
        />
      </div>
    </TooltipProvider>
  );
}

function FlagToggle({
  checked,
  onCheckedChange,
  label,
  help,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground/60 hover:text-foreground"
            onClick={(e) => e.preventDefault()}
          >
            <Info className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-xs">
          {help}
        </TooltipContent>
      </Tooltip>
    </label>
  );
}
