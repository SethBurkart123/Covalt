import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import katex from "katex";

/**
 * Extends InlineMath with an Obsidian-style NodeView: renders KaTeX normally,
 * but clicking it flips to an inline text input showing the raw LaTeX. Blur or
 * Enter commits; Escape cancels.
 */
export const EditableInlineMath = InlineMath.extend({
  addNodeView() {
    const katexOptions = this.options.katexOptions ?? {};

    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement("span");
      wrapper.className = "tiptap-mathematics-render artifact-math-editable";
      wrapper.dataset.type = "inline-math";

      const display = document.createElement("span");
      display.className = "artifact-math-display";
      wrapper.appendChild(display);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "artifact-math-input artifact-math-input--inline";
      input.spellcheck = false;
      input.style.display = "none";
      wrapper.appendChild(input);

      let currentLatex = node.attrs.latex ?? "";

      function renderMath() {
        try {
          katex.render(currentLatex, display, { ...katexOptions, displayMode: false });
          display.classList.remove("artifact-math-error");
        } catch {
          display.textContent = currentLatex || "...";
          display.classList.add("artifact-math-error");
        }
      }

      function enterEditMode() {
        if (!editor.isEditable) return;
        input.value = currentLatex;
        display.style.display = "none";
        input.style.display = "";
        input.focus();
        input.select();
      }

      function exitEditMode(save: boolean) {
        if (save) {
          const newLatex = input.value;
          if (newLatex !== currentLatex) {
            currentLatex = newLatex;
            const pos = getPos();
            if (pos != null) {
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(pos, undefined, { latex: newLatex })
              );
            }
          }
        }
        input.style.display = "none";
        display.style.display = "";
        renderMath();
      }

      wrapper.addEventListener("click", (e) => {
        if (input.style.display !== "none") return;
        e.preventDefault();
        e.stopPropagation();
        enterEditMode();
      });

      input.addEventListener("blur", () => exitEditMode(true));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); exitEditMode(true); editor.commands.focus(); }
        if (e.key === "Escape") { e.preventDefault(); exitEditMode(false); editor.commands.focus(); }
        e.stopPropagation();
      });

      renderMath();

      return {
        dom: wrapper,
        ignoreMutation: () => true,
        stopEvent: (e: Event) => {
          return wrapper.contains(e.target as HTMLElement) && input.style.display !== "none";
        },
      };
    };
  },
});

/**
 * Extends BlockMath with an Obsidian-style NodeView: renders KaTeX normally,
 * but clicking it flips to a textarea showing the raw LaTeX.
 */
export const EditableBlockMath = BlockMath.extend({
  addNodeView() {
    const katexOptions = this.options.katexOptions ?? {};

    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "tiptap-mathematics-render artifact-math-editable";
      wrapper.dataset.type = "block-math";

      const display = document.createElement("div");
      display.className = "artifact-math-display block-math-inner";
      wrapper.appendChild(display);

      const textarea = document.createElement("textarea");
      textarea.className = "artifact-math-input artifact-math-input--block";
      textarea.spellcheck = false;
      textarea.rows = 2;
      textarea.style.display = "none";
      wrapper.appendChild(textarea);

      let currentLatex = node.attrs.latex ?? "";

      function renderMath() {
        try {
          katex.render(currentLatex, display, { ...katexOptions, displayMode: true });
          display.classList.remove("artifact-math-error");
        } catch {
          display.textContent = currentLatex || "...";
          display.classList.add("artifact-math-error");
        }
      }

      function enterEditMode() {
        if (!editor.isEditable) return;
        textarea.value = currentLatex;
        display.style.display = "none";
        textarea.style.display = "";
        textarea.focus();
        textarea.select();
        autoResize();
      }

      function autoResize() {
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
      }

      function exitEditMode(save: boolean) {
        if (save) {
          const newLatex = textarea.value;
          if (newLatex !== currentLatex) {
            currentLatex = newLatex;
            const pos = getPos();
            if (pos != null) {
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(pos, undefined, { latex: newLatex })
              );
            }
          }
        }
        textarea.style.display = "none";
        display.style.display = "";
        renderMath();
      }

      wrapper.addEventListener("click", (e) => {
        if (textarea.style.display !== "none") return;
        e.preventDefault();
        e.stopPropagation();
        enterEditMode();
      });

      textarea.addEventListener("blur", () => exitEditMode(true));
      textarea.addEventListener("input", () => autoResize());
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); exitEditMode(true); editor.commands.focus(); }
        if (e.key === "Escape") { e.preventDefault(); exitEditMode(false); editor.commands.focus(); }
        e.stopPropagation();
      });

      renderMath();

      return {
        dom: wrapper,
        ignoreMutation: () => true,
        stopEvent: (e: Event) => {
          return wrapper.contains(e.target as HTMLElement) && textarea.style.display !== "none";
        },
      };
    };
  },
});
