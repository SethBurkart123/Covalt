"use client";

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MarkdownSerializer } from "@tiptap/pm/markdown";

const serializer = new MarkdownSerializer(
  {
    doc: (state, node) => state.renderContent(node),
    paragraph: (state, node) => {
      state.renderInline(node);
      state.closeBlock(node);
    },
    heading: (state, node) => {
      const level = node.attrs.level ?? 1;
      state.write(`${"#".repeat(level)} `);
      state.renderInline(node);
      state.closeBlock(node);
    },
    text: (state, node) => {
      state.text(node.text || "");
    },
    bulletList: (state, node) => {
      state.renderList(node, "  ", () => "- ");
    },
    orderedList: (state, node) => {
      const start = node.attrs.order ?? 1;
      const max = start + node.childCount - 1;
      const width = String(max).length;
      state.renderList(node, "  ", (i) => {
        const n = start + i;
        return `${" ".repeat(width - String(n).length)}${n}. `;
      });
    },
    listItem: (state, node) => state.renderContent(node),
    blockquote: (state, node) => {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    codeBlock: (state, node) => {
      const language = node.attrs.language || "";
      state.write(`\`\`\`${language}\n`);
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write("```");
      state.closeBlock(node);
    },
    hardBreak: (state) => {
      state.write("  \n");
    },
    horizontalRule: (state, node) => {
      state.write("---");
      state.closeBlock(node);
    },
    atMention: (state, node) => {
      const label = node.attrs.label || node.attrs.id || "";
      state.text(label ? `@${label}` : "@");
    },
  },
  {
    bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    code: { open: "`", close: "`", mixable: true, expelEnclosingWhitespace: true },
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
  }
);

export function serializeChatInputMarkdown(editor: Editor): string {
  return serializer.serialize(editor.state.doc);
}

export function hasMentionNodes(node: ProseMirrorNode): boolean {
  let found = false;
  node.descendants((child) => {
    if (child.type.name === "atMention") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}
