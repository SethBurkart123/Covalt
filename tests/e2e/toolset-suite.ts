import { randomUUID } from "crypto";

const BASE_URL = "http://127.0.0.1:8123";
const REQUEST_TIMEOUT_MS = 60_000;

const decoder = new TextDecoder();

type ToolCallPayload = Record<string, unknown> | null;

interface StreamChatOptions {
  chatId: string;
  modelId: string;
  toolIds: string[];
  message: string;
  autoApprove: boolean;
  waitForRunCompleted: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(command: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE_URL}/command/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Command ${command} failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data?.result ?? data;
}

async function waitForServerReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < REQUEST_TIMEOUT_MS) {
    try {
      await apiRequest("get_active_streams");
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Backend did not become ready in time.");
}

function parseSseChunk(chunk: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const parts = chunk.split("\n\n");
  for (const part of parts) {
    if (!part.trim()) continue;
    let eventName = "message";
    let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data += line.slice(5).trim();
      }
    }
    events.push({ event: eventName, data });
  }
  return events;
}

async function streamChat(options: StreamChatOptions): Promise<{ toolCallCompleted: ToolCallPayload }> {
  const controller = new AbortController();
  const res = await fetch(`${BASE_URL}/channel/stream_chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body: {
        chatId: options.chatId,
        modelId: options.modelId,
        toolIds: options.toolIds,
        messages: [
          {
            id: randomUUID(),
            role: "user",
            content: options.message,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`stream_chat failed: ${res.status} ${text}`);
  }

  const reader = res.body.getReader();
  let buffer = "";
  let toolCallCompleted: ToolCallPayload = null;
  let runCompleted = false;
  let approvalSent = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const event of parts.flatMap(parseSseChunk)) {
      let payload: Record<string, unknown> = {};
      if (event.data) {
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          payload = { content: event.data };
        }
      }

      if (event.event === "ToolApprovalRequired" && options.autoApprove && !approvalSent) {
        const toolPayload = (payload as any)?.tool || {};
        const runId = toolPayload?.runId as string | undefined;
        const tools = Array.isArray(toolPayload?.tools) ? toolPayload.tools : [];
        const toolDecisions = Object.fromEntries(
          tools
            .map((t: any) => t?.id)
            .filter((id: unknown) => typeof id === "string")
            .map((id: string) => [id, true])
        );
        if (runId) {
          await apiRequest("respond_to_tool_approval", {
            body: {
              runId,
              approved: true,
              toolDecisions,
            },
          });
          approvalSent = true;
        }
      }

      if (event.event === "ToolCallCompleted") {
        toolCallCompleted = (payload as any)?.tool || payload;
        if (!options.waitForRunCompleted) {
          controller.abort();
          return { toolCallCompleted };
        }
      }

      if (event.event === "RunCompleted") {
        runCompleted = true;
      }

      if (options.waitForRunCompleted && toolCallCompleted && runCompleted) {
        controller.abort();
        return { toolCallCompleted };
      }
    }
  }

  if (!toolCallCompleted) {
    throw new Error("No ToolCallCompleted event captured.");
  }

  return { toolCallCompleted };
}

function assertRenderPlan(toolCallCompleted: ToolCallPayload): Record<string, unknown> {
  const renderPlan = (toolCallCompleted as any)?.renderPlan;
  if (!renderPlan) {
    throw new Error("ToolCallCompleted missing renderPlan.");
  }
  if (typeof renderPlan.renderer !== "string") {
    throw new Error("renderPlan.renderer missing.");
  }
  return renderPlan as Record<string, unknown>;
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err: any) {
    console.error(`✗ ${name}: ${err?.message || err}`);
    throw err;
  }
}

async function run(): Promise<void> {
  const backend = Bun.spawn(["uv", "run", "main.py"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      COVALT_BACKEND_PORT: "8123",
      COVALT_E2E_TESTS: "1",
      PYTHONUNBUFFERED: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  let success = false;
  try {
    await waitForServerReady();

    await runTest("Toolset RenderPlan", async () => {
      const chatId = randomUUID();
      const { toolCallCompleted } = await streamChat({
        chatId,
        modelId: "e2e:toolset",
        toolIds: ["artifact-tools:write_artifact"],
        message: "make a table",
        autoApprove: false,
        waitForRunCompleted: false,
      });

      const renderPlan = assertRenderPlan(toolCallCompleted);
      const content = (renderPlan as any)?.config?.content;
      if (typeof content !== "string") {
        throw new Error("renderPlan content should be string");
      }
      if (!content.includes("|") || !content.includes("---")) {
        throw new Error("renderPlan content does not look like a markdown table");
      }
    });

    await runTest("Builtin Renderer Fallback", async () => {
      const chatId = randomUUID();
      const { toolCallCompleted } = await streamChat({
        chatId,
        modelId: "e2e:builtin",
        toolIds: ["e2e_echo"],
        message: "echo",
        autoApprove: false,
        waitForRunCompleted: false,
      });

      const renderPlan = assertRenderPlan(toolCallCompleted);
      if ((renderPlan as any).renderer !== "document") {
        throw new Error(`Expected renderer document, got ${(renderPlan as any).renderer}`);
      }
    });

    await runTest("Approval Flow", async () => {
      const chatId = randomUUID();
      const { toolCallCompleted } = await streamChat({
        chatId,
        modelId: "e2e:approval",
        toolIds: ["e2e_requires_approval"],
        message: "approve",
        autoApprove: true,
        waitForRunCompleted: false,
      });

      assertRenderPlan(toolCallCompleted);
    });

    await runTest("Saved RenderPlan Persisted", async () => {
      const chatId = randomUUID();
      await streamChat({
        chatId,
        modelId: "e2e:toolset",
        toolIds: ["artifact-tools:write_artifact"],
        message: "persist",
        autoApprove: false,
        waitForRunCompleted: true,
      });

      const chat = await apiRequest("get_chat", { body: { id: chatId } });
      const messages = Array.isArray(chat?.messages) ? chat.messages : [];

      const collectToolBlocks = (blocks: any[] = []): any[] => {
        const out: any[] = [];
        for (const block of blocks) {
          if (block?.type === "tool_call") {
            out.push(block);
          } else if (block?.type === "member_run" && Array.isArray(block.content)) {
            out.push(...collectToolBlocks(block.content));
          }
        }
        return out;
      };

      const toolBlocks = messages.flatMap((m: any) =>
        Array.isArray(m?.content) ? collectToolBlocks(m.content) : []
      );

      const hasPlan = toolBlocks.some((b: any) => b?.renderPlan?.renderer);
      if (!hasPlan) {
        const snapshot = JSON.stringify(chat).slice(0, 500);
        throw new Error(`Saved content missing renderPlan. Chat snapshot: ${snapshot}`);
      }
    });

    success = true;
  } finally {
    backend.kill("SIGTERM");
    await backend.exited;
    if (!success) {
      process.exitCode = 1;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
