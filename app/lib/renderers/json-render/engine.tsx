import { Fragment, type ReactNode } from "react";
import type {
  ComponentRegistry,
  ComponentRenderer,
  ElementDefinition,
  Spec,
} from "./types";

export type {
  ComponentRegistry,
  ComponentRenderer,
  ComponentRenderProps,
  ElementDefinition,
  Spec,
} from "./types";

export function isValidSpec(value: unknown): value is Spec {
  if (!value || typeof value !== "object") return false;
  const s = value as Spec;
  if (typeof s.root !== "string") return false;
  if (!s.elements || typeof s.elements !== "object") return false;
  return s.root in s.elements;
}

interface RendererProps {
  spec: Spec;
  registry: ComponentRegistry;
  fallback?: ReactNode;
}

export function Renderer({ spec, registry, fallback }: RendererProps): ReactNode {
  if (!isValidSpec(spec)) return fallback ?? null;
  return renderElement(spec.root, spec, registry, new Set<string>());
}

function renderElement(
  id: string,
  spec: Spec,
  registry: ComponentRegistry,
  // Tracks ancestor IDs only; siblings don't share visited state, so a single element
  // referenced from two siblings still renders twice without tripping cycle detection.
  ancestors: Set<string>,
): ReactNode {
  if (ancestors.has(id)) {
    return <ErrorSpan>Cycle detected at element: {id}</ErrorSpan>;
  }
  const def: ElementDefinition | undefined = spec.elements[id];
  if (!def) {
    return <ErrorSpan>Missing element: {id}</ErrorSpan>;
  }
  const renderFn: ComponentRenderer | undefined = registry[def.type];
  if (!renderFn) {
    return <ErrorSpan>Unknown component: {def.type}</ErrorSpan>;
  }
  const children = def.children ?? [];
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(id);
  return (
    <Fragment>
      {renderFn({
        id,
        props: def.props ?? {},
        children,
        renderChildren: () => (
          <Fragment>
            {children.map((cid) => (
              <Fragment key={cid}>
                {renderElement(cid, spec, registry, nextAncestors)}
              </Fragment>
            ))}
          </Fragment>
        ),
      })}
    </Fragment>
  );
}

function ErrorSpan({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="text-destructive text-xs" data-testid="json-render-error">
      {children}
    </span>
  );
}
