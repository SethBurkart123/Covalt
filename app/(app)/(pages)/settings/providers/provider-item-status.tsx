import { CheckCircle, Loader2, XCircle } from 'lucide-react';

type ProviderItemStatusTone = 'success' | 'pending' | 'error';

interface ProviderItemStatusProps {
  tone: ProviderItemStatusTone;
  label: string;
  iconOnly?: boolean;
}

const TONE_CLASS: Record<ProviderItemStatusTone, string> = {
  success: 'text-green-600 dark:text-green-500',
  pending: 'text-amber-600 dark:text-amber-500',
  error: 'text-red-600 dark:text-red-500',
};

export function ProviderItemStatus({ tone, label, iconOnly = false }: ProviderItemStatusProps) {
  const className = TONE_CLASS[tone];

  const icon =
    tone === 'success' ? (
      <CheckCircle size={14} />
    ) : tone === 'pending' ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : (
      <XCircle size={14} />
    );

  if (iconOnly) {
    return <span className={className}>{icon}</span>;
  }

  return (
    <span className={`flex items-center gap-1 text-xs ${className}`}>
      {icon}
      {label}
    </span>
  );
}
