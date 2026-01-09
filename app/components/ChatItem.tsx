"use client";

import * as React from "react";
import {
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Circle,
  Star,
} from "lucide-react";
import clsx from "clsx";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChatItemProps {
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  isPausedForApproval: boolean;
  hasError: boolean;
  hasUnseenUpdate: boolean;
  isEditing: boolean;
  editTitle: string;
  onEditTitleChange: (value: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  isStarred?: boolean;
  onToggleStar?: () => void;
}

export function ChatItem({
  title,
  isActive,
  isStreaming,
  isPausedForApproval,
  hasError,
  hasUnseenUpdate,
  isEditing,
  editTitle,
  onEditTitleChange,
  onEditConfirm,
  onEditCancel,
  onSelect,
  onRename,
  onDelete,
  isStarred = false,
  onToggleStar,
}: ChatItemProps) {
  return (
    <SidebarMenuItem>
      <div className="group/chat relative flex w-full items-center">
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEditConfirm();
              }
              if (e.key === "Escape") {
                onEditCancel();
              }
            }}
            onBlur={onEditConfirm}
            className="flex-1 px-3 py-1.5 rounded-lg bg-background text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring h-auto text-sm"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <button
              onClick={onSelect}
              className={clsx(
                "flex-1 truncate py-1.5 px-3 rounded-lg text-left text-sm flex items-center gap-2",
                isActive
                  ? "bg-sidebar-accent/80 text-sidebar-accent-foreground"
                  : "hover:bg-muted/50",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
              title={title}
            >
              {isStreaming && (
                <Loader2 className="size-3 animate-spin text-primary flex-shrink-0" />
              )}
              {isPausedForApproval && (
                <AlertCircle className="size-3 text-amber-500 flex-shrink-0" />
              )}
              {hasError && !isActive && (
                <AlertCircle className="size-3 text-destructive flex-shrink-0" />
              )}
              {hasUnseenUpdate &&
                !isActive &&
                !isStreaming &&
                !isPausedForApproval &&
                !hasError && (
                  <Circle className="size-2 fill-primary text-primary flex-shrink-0" />
                )}
              <span className="truncate">{title}</span>
            </button>
            <div className="absolute right-1 top-0 bottom-0 flex items-center opacity-0 group-hover/chat:opacity-100 transition-opacity duration-150">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className={clsx(
                      "p-1 rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      isActive
                        ? "text-sidebar-accent-foreground"
                        : "text-muted-foreground",
                    )}
                    aria-label={`Chat options for ${title}`}
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                >
                  {onToggleStar && (
                    <DropdownMenuItem onClick={onToggleStar}>
                      <Star
                        className={clsx(
                          "mr-2 size-4",
                          isStarred
                            ? "fill-yellow-500 text-yellow-500"
                            : "text-muted-foreground"
                        )}
                      />
                      {isStarred ? "Unstar" : "Star"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={onRename}>
                    <Pencil className="mr-2 size-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
    </SidebarMenuItem>
  );
}

