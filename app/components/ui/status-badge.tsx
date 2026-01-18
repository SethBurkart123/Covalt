import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatusConfig {
  icon: LucideIcon;
  label: string;
  className: string;
}

interface StatusBadgeProps {
  config: StatusConfig;
  animate?: boolean;
}

export function StatusBadge({ config, animate = false }: StatusBadgeProps) {
  const { icon: Icon, label, className } = config;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border",
        className
      )}
    >
      <Icon className={cn("size-3", animate && "animate-spin")} />
      {label}
    </span>
  );
}
