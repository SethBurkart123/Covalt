"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
}

export function useVariables({
  storageKey,
  specs,
  optionsContext,
}: UseVariablesArgs): VariablesContext {
  const defaults = useMemo(() => buildDefaults(specs), [specs]);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    loadPersistedValues(storageKey, defaults),
  );

  useEffect(() => {
    setValues(loadPersistedValues(storageKey, defaults));
  }, [storageKey, defaults]);

  const setValue = useCallback(
    (id: string, value: unknown) => {
      setValues((prev) => {
        const next = { ...prev, [id]: value };
        persistVariableValues(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    setValues(defaults);
    persistVariableValues(storageKey, defaults);
  }, [defaults, storageKey]);

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
