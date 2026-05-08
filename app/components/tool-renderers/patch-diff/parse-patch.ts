export type PatchAction = "update" | "create" | "delete";

export interface ParsedFilePatch {
  path: string;
  action: PatchAction;
  oldContent: string;
  newContent: string;
  additions: number;
  deletions: number;
}

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const UPDATE = "*** Update File: ";
const ADD = "*** Add File: ";
const DELETE = "*** Delete File: ";
const END_OF_FILE = "*** End of File";

function startNewFile(action: PatchAction, path: string): ParsedFilePatch {
  return {
    path,
    action,
    oldContent: "",
    newContent: "",
    additions: 0,
    deletions: 0,
  };
}

function appendContext(file: ParsedFilePatch, line: string): void {
  file.oldContent += `${line}\n`;
  file.newContent += `${line}\n`;
}

function appendAddition(file: ParsedFilePatch, line: string): void {
  file.newContent += `${line}\n`;
  file.additions += 1;
}

function appendDeletion(file: ParsedFilePatch, line: string): void {
  file.oldContent += `${line}\n`;
  file.deletions += 1;
}

function detectHeader(line: string): { action: PatchAction; path: string } | null {
  if (line.startsWith(UPDATE)) {
    return { action: "update", path: line.slice(UPDATE.length).trim() };
  }
  if (line.startsWith(ADD)) {
    return { action: "create", path: line.slice(ADD.length).trim() };
  }
  if (line.startsWith(DELETE)) {
    return { action: "delete", path: line.slice(DELETE.length).trim() };
  }
  return null;
}

function applyHunkLine(file: ParsedFilePatch, line: string): void {
  if (line.length === 0) {
    appendContext(file, "");
    return;
  }
  const prefix = line[0];
  const content = line.slice(1);
  if (prefix === "+") {
    appendAddition(file, content);
  } else if (prefix === "-") {
    appendDeletion(file, content);
  } else if (prefix === " ") {
    appendContext(file, content);
  } else {
    appendContext(file, line);
  }
}

export function parseOpenAIPatch(raw: string): ParsedFilePatch[] {
  if (!raw || typeof raw !== "string") return [];
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.includes(BEGIN) && !text.includes(UPDATE) && !text.includes(ADD) && !text.includes(DELETE)) {
    return [];
  }

  const lines = text.split("\n");
  const files: ParsedFilePatch[] = [];
  let current: ParsedFilePatch | null = null;

  let inPatch = false;
  for (const line of lines) {
    if (line === BEGIN) {
      inPatch = true;
      continue;
    }
    if (line === END) {
      inPatch = false;
      current = null;
      continue;
    }
    const header = detectHeader(line);
    if (header) {
      current = startNewFile(header.action, header.path);
      files.push(current);
      continue;
    }
    if (line === END_OF_FILE || line.startsWith("@@")) continue;
    if (!current) continue;
    if (!inPatch && line.length === 0) continue;
    applyHunkLine(current, line);
  }

  return files;
}
