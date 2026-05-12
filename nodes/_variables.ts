/**
 * Hand-mirrored 1:1 with nodes/_variables.py (Python is canonical, no on-wire
 * translation). Edit both files in the same commit.
 */

import type { ShowWhen } from './_types';

export type ControlKind =
  | { kind: 'text'; placeholder?: string }
  | { kind: 'text-area'; rows?: number; placeholder?: string }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'slider'; min: number; max: number; step?: number }
  | { kind: 'boolean' }
  | { kind: 'select'; multi?: boolean }
  | { kind: 'searchable'; multi?: boolean; grouped?: boolean };

export type ControlKindId = ControlKind['kind'];

export interface VariableOption {
  value: unknown;
  label: string;
  group?: string;
  icon?: string;
}

/**
 * link.socketType selects which socket type the editor exposes; the target
 * handle id is always `vars/<spec.id>` (see `variableLinkHandle`).
 * callback.load is a `register_options_loader` id; params is opaque.
 */
export type OptionsSource =
  | { kind: 'static'; options: readonly VariableOption[] }
  | { kind: 'link'; socketType: string }
  | { kind: 'callback'; load: string; params?: Record<string, unknown> };

export interface VariableSpec {
  id: string;
  label: string;
  description?: string;
  section?: string;
  control: ControlKind;
  options?: OptionsSource;
  default?: unknown;
  required?: boolean;
  placement?: 'header' | 'advanced';
  show_when?: ShowWhen;
  /** Set by chat-start when merging in a downstream node's contribution. */
  contributed_by?: string;
  /**
   * Routing hint for the frontend submit path. "node" (default) → values are
   * sent in the `variables` map. "model_option" → values are sent in the
   * `modelOptions` map so backend per-model schema validation applies.
   */
  source?: 'node' | 'model_option';
}

export type VariableValueMap = Record<string, unknown>;

export const VARIABLE_LINK_HANDLE_PREFIX = 'vars/';

export function variableIdSuffix(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'node';
}

export function nodeModelVariableId(nodeId: string): string {
  return `model_${variableIdSuffix(nodeId)}`;
}

export function variableLinkHandle(specId: string): string {
  return `${VARIABLE_LINK_HANDLE_PREFIX}${specId}`;
}

export function isVariableLinkHandle(handle: string | null | undefined): boolean {
  return typeof handle === 'string' && handle.startsWith(VARIABLE_LINK_HANDLE_PREFIX);
}

export function variableIdFromLinkHandle(handle: string): string | null {
  if (!handle.startsWith(VARIABLE_LINK_HANDLE_PREFIX)) return null;
  const id = handle.slice(VARIABLE_LINK_HANDLE_PREFIX.length);
  return id || null;
}
