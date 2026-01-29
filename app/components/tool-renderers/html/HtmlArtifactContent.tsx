"use client";

import { buildHtml } from "./utils";

interface HtmlArtifactContentProps {
  html: string;
  data?: unknown;
}

export function HtmlArtifactContent({ html, data }: HtmlArtifactContentProps) {
  const blobUrl = URL.createObjectURL(
    new Blob([buildHtml(html, data)], { type: "text/html" })
  );

  return (
    <iframe
      src={blobUrl}
      className="w-full h-full flex-1"
      style={{ height: "75vh" }}
      referrerPolicy="no-referrer"
      title="HTML Artifact"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
