'use client';

import { cn } from '@/lib/utils';

export function AgentCardSkeleton() {
  return (
    <div
      className={cn(
        'rounded-lg border-2 overflow-hidden',
        'border-border'
      )}
    >
      <div className="aspect-video bg-muted/30 animate-pulse" />
      <div className="p-3 space-y-2 bg-card">
        <div className="flex items-start gap-2">
          <div className="shrink-0 size-6 rounded bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-full rounded bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
