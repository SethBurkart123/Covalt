import type {
  FrontendHookContextMap,
  FrontendHookHandler,
  FrontendHookResultMap,
  FrontendHookType,
} from '@nodes/_types';

interface RegisteredHook {
  pluginId: string;
  handler: (context: unknown) => unknown;
}

const hookRegistry = new Map<FrontendHookType, RegisteredHook[]>();

function getHooks(hookType: FrontendHookType): RegisteredHook[] {
  return hookRegistry.get(hookType) ?? [];
}

function assertPluginId(pluginId: string): void {
  if (typeof pluginId !== 'string' || !pluginId.trim()) {
    throw new Error('pluginId must be a non-empty string');
  }
}

export function registerHook<T extends FrontendHookType>(
  pluginId: string,
  hookType: T,
  handler: FrontendHookHandler<T>
): void {
  assertPluginId(pluginId);
  if (typeof handler !== 'function') {
    throw new TypeError('hook handler must be a function');
  }

  const entries = getHooks(hookType);
  entries.push({
    pluginId: pluginId.trim(),
    handler: handler as (context: unknown) => unknown,
  });
  hookRegistry.set(hookType, entries);
}

export function dispatchHook<T extends FrontendHookType>(
  hookType: T,
  context: FrontendHookContextMap[T]
): Array<Exclude<FrontendHookResultMap[T], null | undefined>> {
  const entries = getHooks(hookType);
  const results: Array<Exclude<FrontendHookResultMap[T], null | undefined>> = [];

  for (const entry of entries) {
    try {
      const value = entry.handler(context) as FrontendHookResultMap[T];
      if (value !== undefined && value !== null) {
        results.push(value as Exclude<FrontendHookResultMap[T], null | undefined>);
      }
    } catch (error) {
      console.error(
        `[plugin-hooks] ${entry.pluginId} ${hookType} hook failed`,
        error
      );
    }
  }

  return results;
}

export function deregisterHooks(pluginId: string): void {
  assertPluginId(pluginId);
  const normalized = pluginId.trim();

  for (const [hookType, entries] of hookRegistry.entries()) {
    hookRegistry.set(
      hookType,
      entries.filter((entry) => entry.pluginId !== normalized)
    );
  }
}

export function resetHooksForTests(): void {
  hookRegistry.clear();
}
