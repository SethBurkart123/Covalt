import type { ReactNode } from "react";

export interface ElementDefinition {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
}

export interface Spec {
  root: string;
  elements: Record<string, ElementDefinition>;
}

export interface ComponentRenderProps {
  id: string;
  props: Record<string, unknown>;
  children: string[];
  renderChildren: () => ReactNode;
}

export type ComponentRenderer = (props: ComponentRenderProps) => ReactNode;

export type ComponentRegistry = Record<string, ComponentRenderer>;
