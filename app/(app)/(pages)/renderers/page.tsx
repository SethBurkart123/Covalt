"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Renderer } from "@/lib/renderers/json-render/engine";
import { defaultJsonRenderRegistry } from "@/lib/renderers/json-render/components";
import { TerminalRenderer } from "@/components/tool-renderers/terminal/TerminalRenderer";
import { TerminalApproval } from "@/components/tool-renderers/terminal/TerminalApproval";
import { FileDiffRenderer } from "@/components/tool-renderers/file-diff/FileDiffRenderer";
import { FileDiffApproval } from "@/components/tool-renderers/file-diff/FileDiffApproval";
import { PatchDiffRenderer } from "@/components/tool-renderers/patch-diff/PatchDiffRenderer";
import { PatchDiffApproval } from "@/components/tool-renderers/patch-diff/PatchDiffApproval";
import { WebSearchRenderer } from "@/components/tool-renderers/web-search/WebSearchRenderer";
import { TodoListRenderer } from "@/components/tool-renderers/todo-list/TodoListRenderer";
import { FileReadRenderer } from "@/components/tool-renderers/file-read/FileReadRenderer";
import { KeyValueRenderer } from "@/components/tool-renderers/key-value/KeyValueRenderer";
import { DefaultApproval } from "@/components/approvals/DefaultApproval";
import type { ToolCallPayload } from "@/lib/types/chat";
import type { ApprovalRequest } from "@/lib/renderers";
import {
  PATCH_SAMPLE,
  FILE_OLD,
  FILE_NEW,
  READ_CONTENT,
  SEARCH_RESULTS,
  TODOS,
  JSON_SPECS,
} from "./fixtures";

function Section({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div>{children}</div>
    </div>
  );
}

const tc = (over: Partial<ToolCallPayload> & { result?: unknown } = {}): ToolCallPayload => {
  const { result, ...rest } = over;
  return {
    id: "demo-tc",
    toolCallId: "demo-tc",
    toolName: "demo",
    toolArgs: {},
    isCompleted: true,
    toolResult: result === undefined ? undefined : typeof result === "string" ? result : JSON.stringify(result),
    ...rest,
  };
};

const noopResolve = async (): Promise<void> => {};

const baseApproval: Omit<ApprovalRequest, "config" | "renderer" | "options"> = {
  requestId: "req-demo",
  runId: "run-demo",
  kind: "tool_approval",
  toolUseIds: ["tu-1"],
  toolName: "execute",
  riskLevel: "medium",
  summary: "Run shell command",
  questions: [],
  editable: [],
};

const opts = {
  approve: { value: "allow_once", label: "Approve", role: "allow_once" as const, style: "primary" as const },
  approveSession: { value: "allow_session", label: "Allow for session", role: "allow_session" as const },
  deny: { value: "deny", label: "Deny", role: "deny" as const, style: "destructive" as const },
};


export default function RenderersDemoPage() {
  const [pendingTab, setPendingTab] = useState(true);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-12 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Renderer demo</h1>
        <p className="text-sm text-muted-foreground">
          Every built-in renderer with realistic sample data. Use this page to gut-check visual consistency
          before wiring renderers into live executors.
        </p>
      </header>

      <Section title="Approval cards" sub="Default approval renderer in five different request shapes.">
        <div className="flex gap-2">
          <Button
            variant={pendingTab ? "default" : "outline"}
            size="sm"
            onClick={() => setPendingTab(true)}
          >
            Pending
          </Button>
          <Button
            variant={pendingTab ? "outline" : "default"}
            size="sm"
            onClick={() => setPendingTab(false)}
          >
            Resolved
          </Button>
        </div>

        <Demo label="Pure approve / deny">
          <DefaultApproval
            request={{
              ...baseApproval,
              options: [opts.approve, opts.deny],
              config: { toolArgs: { command: "ls -la /tmp" } },
            }}
            isPending={pendingTab}
            onResolve={noopResolve}
          />
        </Demo>

        <Demo label="Multi-option (allow once / allow session / deny)">
          <DefaultApproval
            request={{
              ...baseApproval,
              toolName: "read",
              riskLevel: "low",
              summary: "Read file: README.md",
              options: [opts.approve, opts.approveSession, opts.deny],
              config: { toolArgs: { path: "README.md" } },
            }}
            isPending={pendingTab}
            onResolve={noopResolve}
          />
        </Demo>

        <Demo label="Edit-then-approve (editable args)">
          <DefaultApproval
            request={{
              ...baseApproval,
              riskLevel: "high",
              summary: "Run command (editable before approve)",
              options: [opts.approve, opts.deny],
              editable: [
                { path: ["command"], schema: { type: "string", format: "multiline" }, label: "Command" },
              ],
              config: { toolArgs: { command: "rm -rf node_modules && bun install" } },
            }}
            isPending={pendingTab}
            onResolve={noopResolve}
          />
        </Demo>

        <Demo label="Ask user (multi-question)">
          <DefaultApproval
            request={{
              ...baseApproval,
              toolName: "ask_user",
              kind: "user_input",
              riskLevel: undefined,
              summary: "Need additional details",
              options: [{ value: "submit", label: "Submit", role: "custom", style: "primary" }],
              questions: [
                { index: 0, topic: "scope", question: "What scope should the migration cover?", options: ["Backend", "Frontend", "Both"], required: true },
                { index: 1, topic: "notes", question: "Any extra context?", multiline: true, placeholder: "Optional notes…", required: false },
              ],
              config: {},
            }}
            isPending={pendingTab}
            onResolve={noopResolve}
          />
        </Demo>

        <Demo label="Requires-input gating (button disabled until questions answered)">
          <DefaultApproval
            request={{
              ...baseApproval,
              toolName: "exit_spec_mode",
              summary: "Spec mode — confirm scope",
              options: [
                { value: "allow_once", label: "Approve", role: "allow_once", style: "primary", requiresInput: true },
                opts.deny,
              ],
              questions: [
                { index: 0, topic: "scope", question: "Type 'I understand' to confirm", required: true, placeholder: "I understand" },
              ],
              config: { toolArgs: { spec: "lengthy spec content here" } },
            }}
            isPending={pendingTab}
            onResolve={noopResolve}
          />
        </Demo>
      </Section>

      <Section title="Terminal renderer" sub="Tool body for shell/exec calls. Approval variant supports edit-before-run.">
        <Demo label="Tool body (completed)">
          <TerminalRenderer
            toolCall={tc({
              toolName: "execute",
              toolArgs: { command: "ls -la" },
              result: {
                stdout: "total 24\ndrwxr-xr-x  5 user  staff   160 May  8 12:00 .\n-rw-r--r--  1 user  staff  1234 May  8 12:00 README.md\n",
                exitCode: 0,
              },
            })}
            config={{ command: "ls -la", exitCode: 0, cwd: "/Users/seth/project" }}
          />
        </Demo>

        <Demo label="Tool body (failed)">
          <TerminalRenderer
            toolCall={tc({
              toolName: "execute",
              toolArgs: { command: "false" },
              result: { stdout: "", stderr: "permission denied: cannot read file", exitCode: 1 },
            })}
            config={{ command: "false", exitCode: 1 }}
          />
        </Demo>

        <Demo label="Approval (with editable command)">
          <TerminalApproval
            request={{
              ...baseApproval,
              riskLevel: "high",
              summary: "Run shell command",
              renderer: "terminal",
              options: [opts.approve, opts.deny],
              editable: [{ path: ["command"], schema: { type: "string", format: "multiline" }, label: "Command" }],
              config: { command: "rm -rf node_modules && bun install", cwd: "/Users/seth/project", toolArgs: { command: "rm -rf node_modules && bun install" } },
            }}
            isPending={true}
            onResolve={noopResolve}
          />
        </Demo>
      </Section>

      <Section title="File-diff renderer" sub="For str_replace / edit / write_file style tools.">
        <Demo label="Tool body (full file diff)">
          <FileDiffRenderer
            toolCall={tc({ toolName: "edit", toolArgs: { path: "src/math.ts", old_str: FILE_OLD, new_str: FILE_NEW } })}
            config={{ filePath: "src/math.ts", oldContent: FILE_OLD, newContent: FILE_NEW }}
          />
        </Demo>

        <Demo label="Approval (would apply this diff, editable new_str)">
          <FileDiffApproval
            request={{
              ...baseApproval,
              toolName: "edit",
              riskLevel: "medium",
              summary: "Edit src/math.ts",
              renderer: "file-diff",
              options: [opts.approve, opts.deny],
              editable: [
                { path: ["new_str"], schema: { type: "string", format: "multiline" }, label: "New content" },
              ],
              config: { filePath: "src/math.ts", oldContent: FILE_OLD, newContent: FILE_NEW, toolArgs: { path: "src/math.ts", new_str: FILE_NEW } },
            }}
            isPending={true}
            onResolve={noopResolve}
          />
        </Demo>
      </Section>

      <Section title="Patch-diff renderer" sub="For OpenAI '*** Begin Patch' multi-file envelopes.">
        <Demo label="Tool body (multi-file patch)">
          <PatchDiffRenderer
            toolCall={tc({ toolName: "apply_patch", toolArgs: { patch: PATCH_SAMPLE } })}
            config={{ patch: PATCH_SAMPLE }}
          />
        </Demo>

        <Demo label="Approval">
          <PatchDiffApproval
            request={{
              ...baseApproval,
              toolName: "apply_patch",
              riskLevel: "high",
              summary: "Apply patch to 2 files",
              renderer: "patch-diff",
              options: [opts.approve, opts.deny],
              config: { patch: PATCH_SAMPLE, toolArgs: { patch: PATCH_SAMPLE } },
            }}
            isPending={true}
            onResolve={noopResolve}
          />
        </Demo>
      </Section>

      <Section title="Other tool renderers">
        <Demo label="Web search">
          <WebSearchRenderer
            toolCall={tc({ toolName: "web_search", toolArgs: { query: "tinygrad" }, result: { results: SEARCH_RESULTS } })}
            config={{ query: "tinygrad", results: SEARCH_RESULTS }}
          />
        </Demo>

        <Demo label="Todo list">
          <TodoListRenderer
            toolCall={tc({ toolName: "todo_write", toolArgs: { todos: TODOS } })}
            config={{ todos: TODOS }}
          />
        </Demo>

        <Demo label="File read">
          <FileReadRenderer
            toolCall={tc({ toolName: "read", toolArgs: { path: "src/hooks/useCounter.ts" }, result: { content: READ_CONTENT } })}
            config={{ path: "src/hooks/useCounter.ts", content: READ_CONTENT, startLine: 1, endLine: READ_CONTENT.split("\n").length }}
          />
        </Demo>

        <Demo label="Key/value (generic structured display)">
          <KeyValueRenderer
            toolCall={tc({ toolName: "describe", toolArgs: {}, result: {} })}
            config={{
              title: "Connection",
              rows: [
                { label: "Host", value: "localhost" },
                { label: "Port", value: 5432 },
                { label: "SSL", value: "required" },
                { label: "Region", value: "us-east-1" },
              ],
            }}
          />
        </Demo>
      </Section>

      <Section title="JSON-render components" sub="The 18 vendored components, fed sample specs.">
        <div className="space-y-6">
          {JSON_SPECS.map((s) => (
            <Demo key={s.name} label={s.name}>
              <Card className="overflow-hidden">
                <div className="border-b bg-muted/30 px-3 py-2">
                  <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                    Structured output
                  </span>
                </div>
                <div className="p-3">
                  <Renderer spec={s.spec} registry={defaultJsonRenderRegistry} />
                </div>
              </Card>
            </Demo>
          ))}
        </div>
      </Section>
    </div>
  );
}
