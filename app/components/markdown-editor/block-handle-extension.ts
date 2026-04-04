import { Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const BLOCK_HANDLE_KEY = new PluginKey("blockHandle");

export interface BlockHandleCallbacks {
  onOpen: (pos: number, rect: DOMRect) => void;
  onClose: () => void;
}

/**
 * Adds a Notion-style drag handle (⋮⋮) to the left of each top-level block.
 * Visible on hover, clicking it selects the block and calls onOpen so the
 * React layer can show a command menu.
 */
export const BlockHandle = Extension.create<BlockHandleCallbacks>({
  name: "blockHandle",

  addOptions() {
    return {
      onOpen: () => {},
      onClose: () => {},
    };
  },

  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    const editor = this.editor;

    let handleEl: HTMLButtonElement | null = null;
    let currentBlockPos: number | null = null;

    function getHandle(): HTMLButtonElement {
      if (!handleEl) {
        handleEl = document.createElement("button");
        handleEl.type = "button";
        handleEl.className = "artifact-block-handle";
        handleEl.setAttribute("aria-label", "Block menu");
        handleEl.setAttribute("draggable", "true");
        handleEl.innerHTML = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2" r="1.5"/><circle cx="7.5" cy="2" r="1.5"/><circle cx="2.5" cy="7" r="1.5"/><circle cx="7.5" cy="7" r="1.5"/><circle cx="2.5" cy="12" r="1.5"/><circle cx="7.5" cy="12" r="1.5"/></svg>`;

        handleEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (currentBlockPos == null) return;

          const { state, dispatch } = editor.view;
          dispatch(state.tr.setSelection(NodeSelection.create(state.doc, currentBlockPos)));

          const rect = handleEl!.getBoundingClientRect();
          onOpen(currentBlockPos, rect);
        });

        handleEl.addEventListener("mousedown", (e) => {
          // Prevent editor blur when clicking handle
          e.preventDefault();
        });
      }
      return handleEl;
    }

    function hideHandle() {
      const h = getHandle();
      h.style.opacity = "0";
      h.style.pointerEvents = "none";
    }

    function showHandle(rect: DOMRect, editorRect: DOMRect) {
      const h = getHandle();
      h.style.opacity = "1";
      h.style.pointerEvents = "auto";
      // Position to the left of the block, vertically centered on first line
      h.style.top = `${rect.top - editorRect.top}px`;
      h.style.left = "-4px";
    }

    return [
      new Plugin({
        key: BLOCK_HANDLE_KEY,
        view(editorView) {
          const editorDom = editorView.dom;
          // Need the positioned parent (.ProseMirror) so we set position: relative
          editorDom.style.position = "relative";

          const h = getHandle();
          h.style.position = "absolute";
          h.style.opacity = "0";
          h.style.pointerEvents = "none";
          h.style.transition = "opacity 0.15s";
          editorDom.appendChild(h);

          return {
            destroy() {
              h.remove();
              handleEl = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (!editor.isEditable) return false;

              const editorRect = view.dom.getBoundingClientRect();
              const pos = view.posAtCoords({ left: editorRect.left + 20, top: event.clientY });
              if (!pos) { hideHandle(); return false; }

              const $pos = view.state.doc.resolve(pos.pos);
              const depth = $pos.depth;
              if (depth === 0) { hideHandle(); return false; }

              const blockPos = $pos.before(1);
              const blockNode = view.state.doc.nodeAt(blockPos);
              if (!blockNode) { hideHandle(); return false; }

              currentBlockPos = blockPos;

              const domNode = view.nodeDOM(blockPos) as HTMLElement | null;
              if (!domNode) { hideHandle(); return false; }

              const blockRect = domNode.getBoundingClientRect();
              showHandle(blockRect, editorRect);

              return false;
            },
            mouseleave() {
              // Delay hide so user can move to the handle
              setTimeout(() => {
                if (!handleEl?.matches(":hover")) {
                  hideHandle();
                }
              }, 200);
              return false;
            },
          },
        },
      }),
    ];
  },
});
