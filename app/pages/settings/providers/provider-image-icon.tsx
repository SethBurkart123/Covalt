import type { ComponentType } from 'react';
import { CachedImage } from '@/components/ui/cached-image';
import { cn } from '@/lib/utils';
import type { ProviderImageAsset } from './icon-assets';

type ProviderIconProps = {
  size?: number;
  className?: string;
};

export type ProviderIcon = ComponentType<ProviderIconProps>;

const ICON_CACHE = new Map<string, ProviderIcon>();

export const createProviderImageIcon = (asset: ProviderImageAsset): ProviderIcon => {
  return function ProviderImageIcon({ className }: ProviderIconProps) {
    return <CachedImage src={asset.src} alt={asset.alt} className={cn(asset.className, className)} />;
  };
};

export const getProviderImageIcon = (
  iconKey: string,
  assets: Record<string, ProviderImageAsset>,
): ProviderIcon => {
  const cached = ICON_CACHE.get(iconKey);
  if (cached) {
    return cached;
  }

  const asset = assets[iconKey];
  if (!asset) {
    throw new Error(`Unknown provider image icon key: ${iconKey}`);
  }

  const icon = createProviderImageIcon(asset);
  ICON_CACHE.set(iconKey, icon);
  return icon;
};
