import type { ProviderConfig, ProviderDefinition } from '@/lib/types/provider-catalog';
import type { OAuthState, ProviderConnectionStatus } from '@/lib/hooks/providers/types';

export interface ProviderConnectionUiState {
  saving: boolean;
  saved: boolean;
  status: ProviderConnectionStatus;
  error?: string;
}

export interface ProviderOauthUiState {
  code: string;
  enterpriseDomain: string;
  authenticating: boolean;
  revoking: boolean;
  submitting: boolean;
}

export interface ProviderItemRowViewModel {
  def: ProviderDefinition;
  config: ProviderConfig;
  isConnected: boolean;
  isPluginProvider: boolean;
  oauthStatus?: OAuthState;
  connection: ProviderConnectionUiState;
  oauthUi: ProviderOauthUiState;
}

export interface ProviderItemRowActions {
  onChange: (field: keyof ProviderConfig, value: string | boolean) => void;
  onSave: () => Promise<void> | void;
  onTestConnection: () => Promise<void> | void;
  onUninstall?: () => Promise<void> | void;
  onOauthCodeChange: (value: string) => void;
  onOauthEnterpriseDomainChange: (value: string) => void;
  onOauthStart: () => Promise<void> | void;
  onOauthSubmitCode: () => Promise<void> | void;
  onOauthRevoke: () => Promise<void> | void;
  onOauthOpenLink: (url: string) => void;
}
