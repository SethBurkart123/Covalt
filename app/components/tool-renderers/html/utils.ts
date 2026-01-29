export function buildHtml(html: string, data?: unknown): string {
  const trimmed = html.trim();
  const dataScript = data !== undefined
    ? `<script>window.__TOOL_DATA__ = ${JSON.stringify(data)};</script>\n`
    : "";

  if (/<html[\s>]/i.test(trimmed) || /<!doctype\s+html>/i.test(trimmed)) {
    if (/<\/head>/i.test(trimmed)) {
      return trimmed.replace(/<\/head>/i, `${dataScript}</head>`);
    }
    if (/<body[^>]*>/i.test(trimmed)) {
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
