
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VariableOption, VariableSpec } from "@nodes/_variables";
import type { ResolveOptionsContext } from "@/lib/flow/variable-options";
import {
  buildDefaults,
  loadPersistedValues,
  persistVariableValues,
} from "@/lib/flow/variable-defaults";
import {
  isMissingRequiredValue,
  isSpecVisible,
} from "@/lib/flow/variable-visibility";
import { useVariableOptions } from "@/lib/hooks/use-variable-options";

export {
  isMissingRequiredValue,
  isSpecVisible,
} from "@/lib/flow/variable-visibility";

export interface VariablesContext {
  specs: VariableSpec[];
  visibleSpecs: VariableSpec[];
  values: Record<string, unknown>;
  setValue: (id: string, value: unknown) => void;
  reset: () => void;
  getVisibleValues: () => Record<string, unknown>;
  missingRequiredSpecs: VariableSpec[];
  canSubmit: boolean;
  optionsFor: (id: string) => VariableOption[];
  loadingFor: (id: string) => boolean;
  refresh: () => void;
}

interface UseVariablesArgs {
  storageKey: string | null;
  specs: VariableSpec[];
  optionsContext?: ResolveOptionsContext;
  persistedValues?: Record<string, unknown>;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

function resolveValues(
  storageKey: string | null,
  defaults: Record<string, unknown>,
  persistedValues?: Record<string, unknown>,
): Record<string, unknown> {
  if (persistedValues) return { ...defaults, ...persistedValues };
  return loadPersistedValues(storageKey, defaults);
}

export function useVariables({
  storageKey,
  specs,
  optionsContext,
  persistedValues,
  onValuesChange,
}: UseVariablesArgs): VariablesContext {
  const defaults = useMemo(() => buildDefaults(specs), [specs]);
  const persistedKey = useMemo(
    () => JSON.stringify(persistedValues ?? null),
    [persistedValues],
  );
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    resolveValues(storageKey, defaults, persistedValues),
  );
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const commitValues = useCallback(
    (nextValues: Record<string, unknown>) => {
      valuesRef.current = nextValues;
      setValues(nextValues);
      if (onValuesChange) {
        onValuesChange(nextValues);
      } else {
        persistVariableValues(storageKey, nextValues);
      }
    },
    [onValuesChange, storageKey],
  );

  useEffect(() => {
    const nextValues = resolveValues(storageKey, defaults, persistedValues);
    valuesRef.current = nextValues;
    setValues(nextValues);
  }, [storageKey, defaults, persistedKey, persistedValues]);

  const setValue = useCallback(
    (id: string, value: unknown) => {
      commitValues({ ...valuesRef.current, [id]: value });
    },
    [commitValues],
  );

  const reset = useCallback(() => {
    commitValues(defaults);
  }, [commitValues, defaults]);

  const { optionsFor, loadingFor, refresh } = useVariableOptions({
    specs,
    optionsContext,
  });

  const visibleSpecs = useMemo(
    () => specs.filter((spec) => isSpecVisible(spec, values)),
    [specs, values],
  );

  const missingRequiredSpecs = useMemo(
    () =>
      visibleSpecs.filter((spec) =>
        isMissingRequiredValue(spec, values[spec.id] ?? spec.default),
      ),
    [values, visibleSpecs],
  );

  const getVisibleValues = useCallback(() => {
    const visible: Record<string, unknown> = {};
    for (const spec of visibleSpecs) {
      visible[spec.id] = values[spec.id] ?? spec.default;
    }
    return visible;
  }, [values, visibleSpecs]);

  return {
    specs,
    visibleSpecs,
    values,
    setValue,
    reset,
    getVisibleValues,
    missingRequiredSpecs,
    canSubmit: missingRequiredSpecs.length === 0,
    optionsFor,
    loadingFor,
    refresh,
  };
}
