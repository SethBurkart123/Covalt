"use client";

import { useCallback, useEffect, useState } from "react";
import type { VariableOption, VariableSpec } from "@nodes/_variables";
import {
  resolveVariableOptions,
  type ResolveOptionsContext,
} from "@/lib/flow/variable-options";

export interface VariableOptionsResult {
  optionsFor: (id: string) => VariableOption[];
  loadingFor: (id: string) => boolean;
  refresh: () => void;
}

interface UseVariableOptionsArgs {
  specs: VariableSpec[];
  optionsContext?: ResolveOptionsContext;
}

function isDynamicSpec(spec: VariableSpec): boolean {
  if (spec.control.kind !== "select" && spec.control.kind !== "searchable") return false;
  return spec.options !== undefined && spec.options.kind !== "static";
}

export function useVariableOptions({
  specs,
  optionsContext,
}: UseVariableOptionsArgs): VariableOptionsResult {
  const [optionsByVariable, setOptionsByVariable] = useState<Record<string, VariableOption[]>>({});
  const [loadingByVariable, setLoadingByVariable] = useState<Record<string, boolean>>({});
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const dynamicSpecs = specs.filter(isDynamicSpec);

    setLoadingByVariable((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const spec of dynamicSpecs) next[spec.id] = true;
      return next;
    });

    Promise.all(
      dynamicSpecs.map(async (spec) => {
        const options = await resolveVariableOptions(spec, optionsContext ?? {});
        return { id: spec.id, options };
      }),
    ).then((results) => {
      if (cancelled) return;
      setOptionsByVariable((prev) => {
        const next = { ...prev };
        for (const { id, options } of results) next[id] = options;
        return next;
      });
      setLoadingByVariable((prev) => {
        const next = { ...prev };
        for (const { id } of results) next[id] = false;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [specs, optionsContext, reloadToken]);

  const optionsFor = useCallback(
    (id: string): VariableOption[] => {
      const spec = specs.find((s) => s.id === id);
      if (!spec) return [];
      const source = spec.options;
      if (!source) return [];
      if (source.kind === "static") return source.options.slice();
      return optionsByVariable[id] ?? [];
    },
    [optionsByVariable, specs],
  );

  const loadingFor = useCallback(
    (id: string): boolean => Boolean(loadingByVariable[id]),
    [loadingByVariable],
  );

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  return { optionsFor, loadingFor, refresh };
}
