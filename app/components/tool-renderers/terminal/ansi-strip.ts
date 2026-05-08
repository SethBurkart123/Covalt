const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function stripAnsiPreservingNewlines(text: string): string {
  return stripAnsi(text);
}
