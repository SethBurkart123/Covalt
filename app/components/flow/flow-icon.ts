import type { LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';

const ICONS_BY_NAME = Icons as unknown as Record<string, LucideIcon>;

export function getFlowIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Icons.Circle;
  return ICONS_BY_NAME[name] ?? Icons.Circle;
}
