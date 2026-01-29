import { useMemo, useRef } from "react";
import Fuse from "fuse.js";

interface FuzzyItem {
  value: string;
  searchText: string;
}

export function useFuzzyFilter(
  items: FuzzyItem[]
): (value: string, search: string) => number {
  const fuse = useMemo(
    () => new Fuse(items, {
      keys: ["searchText"],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    }),
    [items]
  );

  const cacheRef = useRef<{ search: string; scores: Map<string, number> }>({ search: "", scores: new Map() });

  return useMemo(
    () => (value: string, search: string): number => {
      if (!search) return 1;
      if (cacheRef.current.search === search) {
        return cacheRef.current.scores.get(value) ?? 0;
      }

      const results = fuse.search(search);
      const scores = new Map<string, number>();
      for (const result of results) {
        scores.set(result.item.value, 1 - (result.score ?? 0));
      }
      cacheRef.current = { search, scores };

      return scores.get(value) ?? 0;
    },
    [fuse]
  );
}
