"use client";

interface FrameArtifactContentProps {
  url: string;
  title?: string;
}

export function FrameArtifactContent({ url, title }: FrameArtifactContentProps) {
  return (
    <iframe
      src={url}
      className="w-full h-full flex-1"
      style={{ height: "75vh" }}
      referrerPolicy="no-referrer"
      title={title || "Frame"}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
