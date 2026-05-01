"use client";

const ENABLED =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("profile");

interface OpenSession {
  chatId: string;
  marks: Array<{ name: string; t: number }>;
  rowCommits: number;
  rowMounts: Set<string>;
  reported: boolean;
}

let session: OpenSession | null = null;

export function isProfilingEnabled(): boolean {
  return ENABLED;
}

export function beginChatOpen(chatId: string): void {
  if (!ENABLED) return;
  session = {
    chatId,
    marks: [{ name: "open", t: performance.now() }],
    rowCommits: 0,
    rowMounts: new Set(),
    reported: false,
  };
}

export function mark(name: string): void {
  if (!ENABLED || !session) return;
  session.marks.push({ name, t: performance.now() });
}

export function recordRowCommit(messageId: string): void {
  if (!ENABLED || !session) return;
  session.rowCommits += 1;
  session.rowMounts.add(messageId);
  if (session.rowMounts.size > 0 && !session.reported) {
    queueReport();
  }
}

let reportTimer: number | null = null;
function queueReport(): void {
  if (reportTimer !== null) {
    window.clearTimeout(reportTimer);
  }
  reportTimer = window.setTimeout(() => {
    if (!session || session.reported) return;
    session.reported = true;
    const start = session.marks[0]?.t ?? 0;
    const lines = session.marks.map(
      (m, i) =>
        `  ${m.name.padEnd(28)} +${(m.t - start).toFixed(1)}ms${
          i > 0 ? `  (Δ ${(m.t - session!.marks[i - 1].t).toFixed(1)}ms)` : ""
        }`,
    );
    console.groupCollapsed(
      `[chat-profiler] open ${session.chatId} (${session.rowMounts.size} rows, ${session.rowCommits} commits, ${(performance.now() - start).toFixed(0)}ms)`,
    );
    for (const line of lines) console.log(line);
    console.groupEnd();
  }, 250);
}

export function recordRender(phase: "mount" | "update", actualMs: number): void {
  if (!ENABLED) return;
  console.log(
    `[chat-profiler] ChatMessageList ${phase} ${actualMs.toFixed(1)}ms`,
  );
}
