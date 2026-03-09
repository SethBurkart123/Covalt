import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * Extends the built-in HorizontalRule with a NodeView wrapper so that
 * clicking on a divider properly creates a NodeSelection (making it
 * selectable, deletable, and draggable).
 *
 * A bare <hr> element doesn't reliably receive click events in browsers,
 * so we wrap it in a <div> that ProseMirror can work with.
 */
export const SelectableHorizontalRule = HorizontalRule.extend({
  atom: true,
  selectable: true,
  draggable: true,

  addNodeView() {
    return ({ getPos, editor }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "artifact-hr-wrapper";
      wrapper.setAttribute("data-type", "horizontal-rule");

      const hr = document.createElement("hr");
      wrapper.appendChild(hr);

      wrapper.addEventListener("click", (event) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        const pos = getPos();
        if (pos == null) return;
        editor.view.dispatch(
          editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
        );
        editor.view.focus();
      });

      return { dom: wrapper };
    };
  },
});
