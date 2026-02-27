export type OAuthStatus = 'none' | 'pending' | 'authenticated' | 'error';

export interface OAuthState {
  status: OAuthStatus;
  hasTokens?: boolean;
  authUrl?: string;
  instructions?: string;
  error?: string;
}

export interface ProviderOAuthOverview {
  status: OAuthStatus;
  hasTokens?: boolean;
  authUrl?: string;
  instructions?: string;
  error?: string;
}

export interface ProviderOverview {
  provider: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  enabled?: boolean;
  connected?: boolean;
  oauth?: ProviderOAuthOverview | null;
}

export interface ProviderOverviewResponse {
  providers: ProviderOverview[];
}

export interface ProviderPluginMeta {
  id: string;
  provider: string;
  enabled?: boolean;
  blockedByPolicy?: boolean;
  sourceClass?: 'official' | 'community';
  sourceType?: string | null;
  sourceRef?: string | null;
  indexId?: string | null;
  repoUrl?: string | null;
  trackingRef?: string | null;
  autoUpdateOverride?: 'inherit' | 'enabled' | 'disabled';
  effectiveAutoUpdate?: boolean;
  updateError?: string | null;
  error?: string;
}

export interface ProviderPluginsResponse {
  plugins: ProviderPluginMeta[];
}

export type ProviderConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

export const normalizeOAuthStatus = (value: unknown): OAuthStatus => {
  if (value === 'none' || value === 'pending' || value === 'authenticated' || value === 'error') {
    return value;
  }
  return 'none';
};
