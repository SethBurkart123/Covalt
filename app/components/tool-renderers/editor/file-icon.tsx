import {
  File,
  FileCode2,
  FileJson,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  type LucideIcon,
} from "lucide-react";

const EXTENSION_ICON_MAP: Record<string, LucideIcon> = {
  js: FileCode2,
  jsx: FileCode2,
  ts: FileCode2,
  tsx: FileCode2,
  py: FileCode2,
  rb: FileCode2,
  go: FileCode2,
  rs: FileCode2,
  java: FileCode2,
  c: FileCode2,
  cpp: FileCode2,
  h: FileCode2,
  cs: FileCode2,
  swift: FileCode2,
  kt: FileCode2,
  sh: FileCode2,
  bash: FileCode2,
  zsh: FileCode2,
  html: FileCode2,
  css: FileCode2,
  scss: FileCode2,
  less: FileCode2,
  vue: FileCode2,
  svelte: FileCode2,

  json: FileJson,
  jsonc: FileJson,

  md: FileText,
  mdx: FileText,
  txt: FileText,
  log: FileText,
  yml: FileText,
  yaml: FileText,
  toml: FileText,
  ini: FileText,
  cfg: FileText,
  env: FileText,
  csv: FileSpreadsheet,

  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  ico: FileImage,
  bmp: FileImage,
  avif: FileImage,

  mp4: FileVideo,
  webm: FileVideo,
  mov: FileVideo,
  avi: FileVideo,

  mp3: FileAudio,
  wav: FileAudio,
  ogg: FileAudio,
  flac: FileAudio,

  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
};

export function getFileIcon(filename: string): LucideIcon {
  const ext = filename.includes(".")
    ? filename.split(".").pop()?.toLowerCase()
    : undefined;
  if (ext && ext in EXTENSION_ICON_MAP) {
    return EXTENSION_ICON_MAP[ext];
  }
  return File;
}
