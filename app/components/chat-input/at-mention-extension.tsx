"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  type VirtualElement,
} from "@floating-ui/dom";
import {
  MentionSuggestionList,
  type MentionSuggestionListHandle,
  type MentionSuggestionListProps,
} from "./at-mention-suggestion";

export type MentionType = "tool" | "toolset" | "mcp";

export interface MentionItem {
  id: string;
  label: string;
  type: MentionType;
  title?: string;
  description?: string | null;
  serverLabel?: string | null;
}

export interface MentionAttrs {
  id: string;
  label: string;
  type: MentionType;
}

interface MentionExtensionOptions {
  getSuggestions: (query: string) => MentionItem[];
}

type SuggestionRendererProps = MentionSuggestionListProps & {
  editor: unknown;
  clientRect?: () => DOMRect | null;
};

export const AtMention = Node.create<MentionExtensionOptions>({
  name: "atMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addOptions() {
    return {
      getSuggestions: () => [],
    };
  },

  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-id") || "",
        renderHTML: (attributes) => ({
          "data-id": attributes.id,
        }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") || "",
        renderHTML: (attributes) => ({
          "data-label": attributes.label,
        }),
      },
      type: {
        default: "tool",
        parseHTML: (element) =>
          (element.getAttribute("data-type") as MentionType | null) || "tool",
        renderHTML: (attributes) => ({
          "data-type": attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-at-mention]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.label || node.attrs.id || "";
    return [
      "span",
      mergeAttributes(
        {
          class: "at-mention-pill not-prose",
          "data-at-mention": "true",
          "data-id": node.attrs.id,
          "data-label": label,
          "data-type": node.attrs.type,
        },
        HTMLAttributes
      ),
      `@${label}`,
    ];
  },

  renderText({ node }) {
    const label = node.attrs.label || node.attrs.id || "";
    return label ? `@${label}` : "@";
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey("atMentionSuggestion"),
        char: "@",
        allowSpaces: false,
        items: ({ query }) => this.options.getSuggestions(query).slice(0, 20),
        command: ({ editor, range, props }) => {
          const attrs: MentionAttrs = {
            id: props.id,
            label: props.label,
            type: props.type,
          };
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: this.name, attrs },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => createSuggestionRenderer(),
      }),
    ];
  },
});

function createSuggestionRenderer() {
  let component: ReactRenderer<MentionSuggestionListHandle> | null = null;
  let container: HTMLDivElement | null = null;
  let cleanup: (() => void) | null = null;

  const updatePosition = async (props: { clientRect?: () => DOMRect | null }) => {
    if (!container) return;
    const rect = props.clientRect?.();
    if (!rect) return;

    const virtualElement: VirtualElement = {
      getBoundingClientRect: () => rect,
    };

    const { x, y } = await computePosition(virtualElement, container, {
      placement: "bottom-start",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    });

    Object.assign(container.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
  };

  return {
    onStart: (props: SuggestionRendererProps) => {
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.zIndex = "9999";
      document.body.appendChild(container);

      component = new ReactRenderer(MentionSuggestionList, {
        props,
        editor: props.editor,
      });

      container.appendChild(component.element);
      updatePosition(props);

      const rect = props.clientRect?.();
      if (rect) {
        const virtualElement: VirtualElement = {
          getBoundingClientRect: () => props.clientRect?.() ?? rect,
        };
        cleanup = autoUpdate(virtualElement, container, () => updatePosition(props));
      }
    },

    onUpdate: (props: SuggestionRendererProps) => {
      component?.updateProps(props);
      updatePosition(props);
      cleanup?.();
      cleanup = null;
      const rect = props.clientRect?.();
      if (rect && container) {
        const virtualElement: VirtualElement = {
          getBoundingClientRect: () => props.clientRect?.() ?? rect,
        };
        cleanup = autoUpdate(virtualElement, container, () => updatePosition(props));
      }
    },

    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (props.event.key === "Escape") return false;
      return component?.ref?.onKeyDown(props) ?? false;
    },

    onExit: () => {
      cleanup?.();
      cleanup = null;
      component?.destroy();
      container?.remove();
      component = null;
      container = null;
    },
  };
}
