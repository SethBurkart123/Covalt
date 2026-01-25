/**
 * Builds a complete HTML document from the provided HTML content.
 * If the content already has html/doctype tags, injects the data script appropriately.
 * Otherwise, wraps the content in a basic HTML document structure.
 */
export function buildHtml(html: string, data?: unknown): string {
  const trimmed = html.trim();
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);
  const hasDoctype = /<!doctype\s+html>/i.test(trimmed);

  const dataScript = data !== undefined
    ? `<script>window.__TOOL_DATA__ = ${JSON.stringify(data)};</script>\n`
    : "";

  if (hasHtmlTag || hasDoctype) {
    if (/<\/head>/i.test(trimmed)) {
      return trimmed.replace(/<\/head>/i, `${dataScript}</head>`);
    } else if (/<body[^>]*>/i.test(trimmed)) {
      return trimmed.replace(/(<body[^>]*>)/i, `$1\n${dataScript}`);
    }
    return trimmed;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${dataScript}
  </head>
  <body>
${trimmed}
  </body>
</html>`;
}
