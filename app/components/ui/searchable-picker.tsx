
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandInput, CommandItem } from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { VirtualizedCommandList } from "@/components/ui/virtualized-command-list";
import { useFuzzyFilter } from "@/lib/hooks/use-fuzzy-filter";
import { cn } from "@/lib/utils";

export interface SearchablePickerOption {
  value: unknown;
  label: string;
  group?: string;
  icon?: ReactNode;
}

interface SearchablePickerProps {
  options: SearchablePickerOption[];
  value: unknown | unknown[];
  onChange: (value: unknown | unknown[]) => void;
  multi?: boolean;
  grouped?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  triggerLabel?: ReactNode;
}

type FlatRow =
  | { kind: "heading"; group: string }
  | { kind: "option"; option: SearchablePickerOption; key: string };

const ITEM_HEIGHT = 32;
const HEADING_HEIGHT = 28;

export const SearchablePicker = memo(function SearchablePicker({
  options,
  value,
  onChange,
  multi = false,
  grouped = false,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No matches.",
  triggerClassName,
  popoverClassName,
  triggerLabel,
}: SearchablePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const selectedSet = useMemo(() => buildSelectedSet(value, multi), [value, multi]);
  const fuzzyItems = useMemo(
    () =>
      options.map((option, index) => ({
        value: String(index),
        searchText: [option.label, option.group].filter(Boolean).join(" "),
      })),
    [options]
  );
  const fuzzyScore = useFuzzyFilter(fuzzyItems);

  const filtered = useMemo(() => {
    if (!search) return options;
    return options
      .map((option, index) => ({ option, index, score: fuzzyScore(String(index), search) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.option);
  }, [fuzzyScore, options, search]);

  const rows = useMemo(() => buildFlatRows(filtered, grouped), [filtered, grouped]);

  const handleSelect = useCallback(
    (option: SearchablePickerOption) => {
      if (!multi) {
        onChange(option.value);
        setOpen(false);
        return;
      }
      const current = Array.isArray(value) ? value.slice() : [];
      const idx = current.findIndex((v) => v === option.value);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(option.value);
      }
      onChange(current);
    },
    [multi, onChange, value]
  );

  const triggerContent = useMemo(() => {
    if (triggerLabel) return triggerLabel;
    if (multi) {
      if (selectedSet.size === 0) return <span className="text-muted-foreground">{placeholder}</span>;
      const labels = options
        .filter((opt) => selectedSet.has(opt.value))
        .map((opt) => opt.label);
      return <span className="truncate">{labels.join(", ")}</span>;
    }
    const match = options.find((opt) => opt.value === value);
    if (!match) return <span className="text-muted-foreground">{placeholder}</span>;
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {match.icon ? <span className="shrink-0">{match.icon}</span> : null}
        <span className="truncate">{match.label}</span>
      </span>
    );
  }, [multi, options, placeholder, selectedSet, triggerLabel, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex shrink-0 items-center gap-1.5 px-3 py-1 text-sm font-medium h-9 justify-between min-w-20 rounded-xl",
            triggerClassName
          )}
        >
          {triggerContent}
          <ChevronDownIcon size={16} className="shrink-0 text-muted-foreground/80" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-full min-w-[min(var(--radix-popper-available-width),32rem)] max-w-[min(var(--radix-popper-available-width),32rem)] overflow-hidden border border-border bg-secondary shadow-lg rounded-2xl p-0",
          popoverClassName
        )}
      >
        <Command className="rounded-2xl" shouldFilter={false} disablePointerSelection>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <VirtualizedCommandList
            items={rows}
            estimateSize={(i) => (rows[i].kind === "heading" ? HEADING_HEIGHT : ITEM_HEIGHT)}
            emptyMessage={emptyMessage}
            className="pb-2 min-h-40 max-h-80"
          >
            {(row) => {
              if (row.kind === "heading") {
                return (
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {row.group}
                  </div>
                );
              }
              const isSelected = selectedSet.has(row.option.value);
              return (
                <CommandItem
                  value={row.key}
                  onSelect={() => handleSelect(row.option)}
                  className="mx-2 hover:bg-accent/50 hover:text-accent-foreground transition-colors duration-100"
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    {row.option.icon ? <span className="shrink-0">{row.option.icon}</span> : null}
                    <span className="truncate">{row.option.label}</span>
                  </span>
                  {isSelected && <CheckIcon size={16} className="ml-auto shrink-0" />}
                </CommandItem>
              );
            }}
          </VirtualizedCommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

function buildSelectedSet(value: unknown, multi: boolean): Set<unknown> {
  if (multi) {
    return new Set(Array.isArray(value) ? value : []);
  }
  return new Set(value === undefined || value === null ? [] : [value]);
}

function buildFlatRows(options: SearchablePickerOption[], grouped: boolean): FlatRow[] {
  if (!grouped) {
    return options.map((option, index) => ({
      kind: "option" as const,
      option,
      key: `${index}:${optionKey(option)}`,
    }));
  }

  const rows: FlatRow[] = [];
  let currentGroup: string | null = null;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const group = option.group ?? "";
    if (group !== currentGroup) {
      if (group) rows.push({ kind: "heading", group });
      currentGroup = group;
    }
    rows.push({ kind: "option", option, key: `${index}:${optionKey(option)}` });
  }
  return rows;
}

function optionKey(option: SearchablePickerOption): string {
  if (typeof option.value === "string") return option.value;
  try {
    return JSON.stringify(option.value);
  } catch {
    return option.label;
  }
}
