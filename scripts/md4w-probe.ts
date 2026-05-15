import { init, mdToHtml, setCodeHighlighter } from "md4w";
import { preprocessPartialMarkdown } from "@/lib/markdown/partial";

const wasmBytes = await Bun.file(
  new URL("../node_modules/md4w/js/md4w-fast.wasm", import.meta.url).pathname,
).arrayBuffer();
await init(wasmBytes);

setCodeHighlighter((language, code) => {
  const safe = language.replace(/[^\w-]/g, "") || "text";
  return `<div class="markdown-code-block"><pre><code class="language-${safe}">${code}</code></pre></div>`;
});

const PARSE_FLAGS = [
  "TABLES",
  "STRIKETHROUGH",
  "TASKLISTS",
  "LATEX_MATH_SPANS",
  "PERMISSIVE_URL_AUTO_LINKS",
  "PERMISSIVE_ATX_HEADERS",
  "COLLAPSE_WHITESPACE",
  "NO_HTML_BLOCKS",
  "NO_HTML_SPANS",
] as const;

function render(source: string): string {
  if (!source) return "";
  try {
    return mdToHtml(source, { parseFlags: [...PARSE_FLAGS] });
  } catch (e) {
    return `<pre class="markdown-fallback">${source}</pre>  (FALLBACK from: ${(e as Error).message})`;
  }
}

function flag(html: string): string {
  if (html.includes("<pre")) return "  <-- CODEBLOCK";
  return "";
}

function probe(label: string, full: string) {
  console.log(`\n=== ${label} ===  ${JSON.stringify(full)}`);
  for (let i = 0; i <= full.length; i++) {
    const chunk = full.slice(0, i);
    const source = preprocessPartialMarkdown(chunk);
    const html = render(source);
    const c = JSON.stringify(chunk).padEnd(20);
    const p = JSON.stringify(source).padEnd(20);
    console.log(`${i.toString().padStart(2)}: ${c} -> pre ${p} -> ${JSON.stringify(html)}${flag(html)}`);
  }
}

probe("hello there heading", "# Hello there");
probe("empty", "");
