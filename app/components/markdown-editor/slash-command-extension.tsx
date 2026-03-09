"use client";

import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from "@floating-ui/dom";
import { Extension, ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  SlashCommandSuggestionList,
  type SlashCommandItem,
  type SlashCommandSuggestionListHandle,
} from "@/components/markdown-editor/slash-command-suggestion";

type SlashSuggestionRendererProps = SuggestionProps<SlashCommandItem, SlashCommandItem>;

interface SlashCommandExtensionOptions {
  items: SlashCommandItem[];
}

export const SlashCommand = Extension.create<SlashCommandExtensionOptions>({
  name: "slashCommand",

  addOptions() {
    return { items: [] };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: "/",
        pluginKey: new PluginKey("slashCommandSuggestion"),
        startOfLine: true,
        items: ({ query }) => {
          const q = query.trim().toLowerCase();
          return this.options.items
            .filter((item) => {
              if (!q) return true;
              const haystack = [item.title, item.subtitle, ...(item.searchTerms ?? [])].join(" ").toLowerCase();
              return haystack.includes(q);
            })
            .slice(0, 12);
        },
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: () => createSuggestionRenderer(),
      }),
    ];
  },
});

function createSuggestionRenderer() {
  let component: ReactRenderer<SlashCommandSuggestionListHandle> | null = null;
  let container: HTMLDivElement | null = null;
  let cleanup: (() => void) | null = null;

  const updatePosition = async (props: { clientRect?: (() => DOMRect | null) | null }) => {
    if (!container) return;
    const rect = props.clientRect?.();
    if (!rect) return;

    const virtualElement: VirtualElement = { getBoundingClientRect: () => rect };
    const { x, y } = await computePosition(virtualElement, container, {
      placement: "bottom-start",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    });

    Object.assign(container.style, { left: `${x}px`, top: `${y}px` });
  };

  return {
    onStart: (props: SlashSuggestionRendererProps) => {
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.zIndex = "9999";
      document.body.appendChild(container);

      component = new ReactRenderer(SlashCommandSuggestionList, {
        props: { items: props.items, command: props.command },
        editor: props.editor,
      });

      container.appendChild(component.element);
      void updatePosition(props);

      const rect = props.clientRect?.();
      if (rect) {
        const virtualElement: VirtualElement = { getBoundingClientRect: () => props.clientRect?.() ?? rect };
        cleanup = autoUpdate(virtualElement, container, () => void updatePosition(props));
      }
    },

    onUpdate: (props: SlashSuggestionRendererProps) => {
      component?.updateProps({ items: props.items, command: props.command });
      void updatePosition(props);
      cleanup?.();
      cleanup = null;

      const rect = props.clientRect?.();
      if (rect && container) {
        const virtualElement: VirtualElement = { getBoundingClientRect: () => props.clientRect?.() ?? rect };
        cleanup = autoUpdate(virtualElement, container, () => void updatePosition(props));
      }
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
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
