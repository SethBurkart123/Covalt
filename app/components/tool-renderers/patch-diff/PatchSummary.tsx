"use client";

import type { ReactNode } from "react";
import type { ParsedFilePatch } from "./parse-patch";

interface PatchSummaryProps {
  files: ParsedFilePatch[];
}

export function summarizePatch(files: ParsedFilePatch[]): string {
  if (files.length === 0) return "0 files changed";
  let updated = 0;
  let created = 0;
  let deleted = 0;
  for (const file of files) {
    if (file.action === "create") created += 1;
    else if (file.action === "delete") deleted += 1;
    else updated += 1;
  }
  const parts: string[] = [];
  if (updated > 0) parts.push(`${updated} updated`);
  if (created > 0) parts.push(`${created} created`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  const fileWord = files.length === 1 ? "file" : "files";
  return `${files.length} ${fileWord} changed: ${parts.join(", ")}`;
}

export function PatchSummary({ files }: PatchSummaryProps): ReactNode {
  return (
    <span
      data-testid="patch-summary"
      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
    >
      {summarizePatch(files)}
    </span>
  );
}
