
import type { ContentBlock } from "@/lib/types/chat";

export const DEFAULT_OUTPUT_SMOOTHING_DELAY_MS = 320;
export const MIN_OUTPUT_SMOOTHING_DELAY_MS = 120;
export const MAX_OUTPUT_SMOOTHING_DELAY_MS = 600;

const MIN_CHARS_PER_SECOND = 48;
const BACKLOG_CURVE_CHARS = 900;
const MAX_FINISH_DELAY_MS = 600;
const FRAME_FALLBACK_MS = 16;

type UpdateCallback = (content: ContentBlock[]) => void;

export interface OutputSmoothingOptions {
  delayMs?: number;
}

export function normalizeOutputSmoothingDelayMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_OUTPUT_SMOOTHING_DELAY_MS;
  return Math.min(
    MAX_OUTPUT_SMOOTHING_DELAY_MS,
    Math.max(MIN_OUTPUT_SMOOTHING_DELAY_MS, Math.round(numeric)),
  );
}

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(nowMs()), FRAME_FALLBACK_MS) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(id);
    return;
  }
  globalThis.clearTimeout(id);
}

function countSmoothableChars(blocks: ContentBlock[]): number {
  return blocks.reduce((total, block) => {
    if (block.type === "text" || block.type === "reasoning") {
      return total + block.content.length;
    }
    if (block.type === "member_run") {
      return total + countSmoothableChars(block.content);
    }
    return total;
  }, 0);
}

function revealBlocks(
  blocks: ContentBlock[],
  visibleChars: number,
  cursor: { value: number },
): ContentBlock[] {
  const revealed: ContentBlock[] = [];

  for (const block of blocks) {
    const start = cursor.value;

    if (block.type === "text" || block.type === "reasoning") {
      cursor.value += block.content.length;

      if (visibleChars <= start) {
        continue;
      }

      const visibleLength = Math.max(0, Math.min(block.content.length, visibleChars - start));
      if (block.type === "reasoning") {
        revealed.push({
          ...block,
          content: block.content.slice(0, visibleLength),
          isCompleted: block.isCompleted && visibleLength >= block.content.length,
        });
      } else {
        revealed.push({
          ...block,
          content: block.content.slice(0, visibleLength),
        });
      }
      continue;
    }

    if (block.type === "member_run") {
      const memberChars = countSmoothableChars(block.content);

      if (visibleChars < start) {
        cursor.value += memberChars;
        continue;
      }

      const nested = revealBlocks(block.content, visibleChars, cursor);
      revealed.push({
        ...block,
        content: nested,
        isCompleted: block.isCompleted && visibleChars >= cursor.value,
      });
      continue;
    }

    if (visibleChars >= start) {
      revealed.push(block);
    }
  }

  return revealed;
}

function visibleContentFor(target: ContentBlock[], visibleChars: number): ContentBlock[] {
  const cursor = { value: 0 };
  return revealBlocks(target, Math.floor(visibleChars), cursor);
}

function targetLagSecondsForBacklog(backlogChars: number, delayMs: number): number {
  const sweetSpotLagSeconds = normalizeOutputSmoothingDelayMs(delayMs) / 1000;
  const maxLagSeconds = Math.min(
    MAX_OUTPUT_SMOOTHING_DELAY_MS / 1000,
    Math.max(sweetSpotLagSeconds + 0.16, sweetSpotLagSeconds * 1.5),
  );

  if (backlogChars <= 0) return sweetSpotLagSeconds;
  const t = 1 - Math.exp(-backlogChars / BACKLOG_CURVE_CHARS);
  return sweetSpotLagSeconds + (maxLagSeconds - sweetSpotLagSeconds) * t;
}

export class OutputSmoothingController {
  private target: ContentBlock[] = [];
  private targetChars = 0;
  private visibleChars = 0;
  private currentSpeed = MIN_CHARS_PER_SECOND;
  private lastFrameAt: number | null = null;
  private frameId: number | null = null;
  private finalDeadlineAt: number | null = null;
  private finishResolver: (() => void) | null = null;
  private readonly delayMs: number;

  constructor(
    private readonly onUpdate: UpdateCallback,
    options: OutputSmoothingOptions = {},
  ) {
    this.delayMs = normalizeOutputSmoothingDelayMs(options.delayMs);
  }

  update(content: ContentBlock[]): void {
    const wasCaughtUp = this.targetChars <= this.visibleChars;
    const nextTargetChars = countSmoothableChars(content);
    this.target = content;
    this.targetChars = nextTargetChars;

    if (this.targetChars <= this.visibleChars) {
      this.visibleChars = this.targetChars;
      this.emit();
      this.resolveIfDone();
      return;
    }

    if (wasCaughtUp) {
      this.currentSpeed = MIN_CHARS_PER_SECOND;
      this.lastFrameAt = null;
    }

    this.schedule();
  }

  finish(content: ContentBlock[]): Promise<void> {
    this.update(content);

    if (this.targetChars <= this.visibleChars) {
      this.emit();
      return Promise.resolve();
    }

    this.finalDeadlineAt = nowMs() + MAX_FINISH_DELAY_MS;
    this.schedule();

    return new Promise((resolve) => {
      this.finishResolver = resolve;
    });
  }

  dispose(): void {
    if (this.frameId !== null) {
      cancelFrame(this.frameId);
      this.frameId = null;
    }
    this.finishResolver?.();
    this.finishResolver = null;
  }

  private schedule(): void {
    if (this.frameId !== null) return;
    this.frameId = requestFrame((timestamp) => this.tick(timestamp));
  }

  private tick(timestamp: number): void {
    this.frameId = null;
    const frameAt = timestamp || nowMs();
    const deltaSeconds = this.lastFrameAt === null
      ? FRAME_FALLBACK_MS / 1000
      : Math.min(Math.max((frameAt - this.lastFrameAt) / 1000, 0.001), 0.1);
    this.lastFrameAt = frameAt;

    if (this.finalDeadlineAt !== null && frameAt >= this.finalDeadlineAt) {
      this.visibleChars = this.targetChars;
      this.emit();
      this.resolveIfDone();
      return;
    }

    const backlog = Math.max(0, this.targetChars - this.visibleChars);
    if (backlog <= 0) {
      this.resolveIfDone();
      return;
    }

    const targetSpeed = this.targetSpeed(backlog, frameAt);
    this.currentSpeed = Math.max(
      MIN_CHARS_PER_SECOND,
      this.currentSpeed + (targetSpeed - this.currentSpeed) * (this.finalDeadlineAt ? 0.65 : 0.35),
    );
    let nextVisible = Math.min(
      this.targetChars,
      this.visibleChars + this.currentSpeed * deltaSeconds,
    );
    if (this.visibleChars === 0 && nextVisible < 1 && this.targetChars >= 1) {
      nextVisible = 1;
    }

    const prevInt = Math.floor(this.visibleChars);
    const nextInt = Math.floor(nextVisible);
    this.visibleChars = nextVisible;

    if (nextInt !== prevInt || this.visibleChars >= this.targetChars) {
      this.emit();
    }

    if (this.visibleChars < this.targetChars) {
      this.schedule();
      return;
    }

    this.resolveIfDone();
  }

  private targetSpeed(backlog: number, frameAt: number): number {
    const lagSeconds = targetLagSecondsForBacklog(backlog, this.delayMs);

    if (this.finalDeadlineAt === null) {
      return Math.max(MIN_CHARS_PER_SECOND, backlog / lagSeconds);
    }

    const remainingSeconds = Math.max((this.finalDeadlineAt - frameAt) / 1000, 0.016);
    return Math.max(
      MIN_CHARS_PER_SECOND,
      backlog / Math.min(lagSeconds, remainingSeconds),
    );
  }

  private emit(): void {
    this.onUpdate(visibleContentFor(this.target, this.visibleChars));
  }

  private resolveIfDone(): void {
    if (this.visibleChars < this.targetChars || !this.finishResolver) return;
    const resolve = this.finishResolver;
    this.finishResolver = null;
    this.finalDeadlineAt = null;
    resolve();
  }
}
