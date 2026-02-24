"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ensureUniqueServerId, slugifyServerId } from "./utils";

export type ConflictResolution = "skip" | "rename" | "overwrite";

interface ImportConflictDialogProps {
  open: boolean;
  serverId: string;
  suggestedName: string;
  onResolve: (resolution: ConflictResolution) => void;
  onCancel: () => void;
}

export function ImportConflictDialog({
  open,
  serverId,
  suggestedName,
  onResolve,
  onCancel,
}: ImportConflictDialogProps) {
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Server Already Exists
          </DialogTitle>
          <DialogDescription>
            A server with ID <span className="font-mono font-medium">&quot;{serverId}&quot;</span> already exists.
            What would you like to do?
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Choose how to handle this conflict:
          </p>
          <ul className="text-sm space-y-2 pl-4">
            <li>
              <strong>Skip:</strong> Don&apos;t import this server
            </li>
            <li>
              <strong>Rename:</strong> Import as <span className="font-mono">&quot;{suggestedName}&quot;</span>
            </li>
            <li>
              <strong>Overwrite:</strong> Replace the existing server
            </li>
          </ul>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onResolve("skip")}>
            Skip
          </Button>
          <Button variant="outline" onClick={() => onResolve("rename")}>
            Rename to &quot;{suggestedName}&quot;
          </Button>
          <Button variant="destructive" onClick={() => onResolve("overwrite")}>
            Overwrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function generateUniqueName(baseName: string, existingIds: Set<string>): string {
  const baseId = slugifyServerId(baseName);
  return ensureUniqueServerId(baseId, existingIds);
}
