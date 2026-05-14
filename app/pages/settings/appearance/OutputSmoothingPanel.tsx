
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_OUTPUT_SMOOTHING_DELAY_MS,
  MAX_OUTPUT_SMOOTHING_DELAY_MS,
  MIN_OUTPUT_SMOOTHING_DELAY_MS,
  OutputSmoothingController,
  normalizeOutputSmoothingDelayMs,
} from "@/lib/services/output-smoothing";
import {
  getOutputSmoothingSettings,
  saveOutputSmoothingSettings,
  setCachedOutputSmoothingSettings,
} from "@/lib/services/output-smoothing-settings";
import type { ContentBlock } from "@/lib/types/chat";

const PREVIEW_TEXT =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent vitae nibh at sapien luctus porta. Curabitur posuere sem vel mi facilisis, sed dictum urna pretium.";

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text" || block.type === "reasoning") return block.content;
      if (block.type === "member_run") return textOf(block.content);
      return "";
    })
    .join("");
}

function TypewriterDot() {
  return <span className="inline-typewriter-indicator" aria-hidden="true" />;
}

function PreviewBubble({
  label,
  text,
  showCursor,
}: {
  label: string;
  text: string;
  showCursor: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="min-h-[118px] rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground">
        <span className="whitespace-pre-wrap">{text}</span>
        {showCursor ? <TypewriterDot /> : null}
      </div>
    </div>
  );
}

function OutputSmoothingPreview({ delayMs }: { delayMs: number }) {
  const [rawText, setRawText] = useState("");
  const [smoothedText, setSmoothedText] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const chunks = [
      Math.round(PREVIEW_TEXT.length * 0.28),
      Math.round(PREVIEW_TEXT.length * 0.72),
      PREVIEW_TEXT.length,
    ];
    const controller = new OutputSmoothingController(
      (content) => {
        if (!cancelled) setSmoothedText(textOf(content));
      },
      { delayMs },
    );

    const schedule = (callback: () => void, ms: number) => {
      timers.push(window.setTimeout(callback, ms));
    };

    const runCycle = () => {
      setRawText("");
      setSmoothedText("");
      controller.update([{ type: "text", content: "" }]);

      chunks.forEach((length, index) => {
        schedule(() => {
          const nextText = PREVIEW_TEXT.slice(0, length);
          setRawText(nextText);
          controller.update([{ type: "text", content: nextText }]);
        }, 260 + index * 460);
      });
    };

    runCycle();
    const interval = window.setInterval(runCycle, 3400);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      timers.forEach(window.clearTimeout);
      controller.dispose();
    };
  }, [delayMs]);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <PreviewBubble
        label="Provider burst"
        text={rawText}
        showCursor={rawText.length < PREVIEW_TEXT.length}
      />
      <PreviewBubble
        label="Smoothed"
        text={smoothedText}
        showCursor={smoothedText.length < PREVIEW_TEXT.length}
      />
    </div>
  );
}

export default function OutputSmoothingPanel() {
  const [enabled, setEnabled] = useState(false);
  const [delayMs, setDelayMs] = useState(DEFAULT_OUTPUT_SMOOTHING_DELAY_MS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const saveDelayTimerRef = useRef<number | null>(null);

  const persistSettings = useCallback(async (nextEnabled: boolean, nextDelayMs: number) => {
    const settings = {
      enabled: nextEnabled,
      delayMs: normalizeOutputSmoothingDelayMs(nextDelayMs),
    };

    setCachedOutputSmoothingSettings(settings);
    setIsSaving(true);

    try {
      await saveOutputSmoothingSettings(settings);
    } catch (error) {
      console.error("Failed to save output smoothing settings", error);
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings(): Promise<void> {
      setIsLoading(true);
      try {
        const settings = await getOutputSmoothingSettings();
        if (cancelled) return;
        const nextEnabled = settings.enabled ?? false;
        const nextDelayMs = normalizeOutputSmoothingDelayMs(settings.delayMs);
        setEnabled(nextEnabled);
        setDelayMs(nextDelayMs);
        setCachedOutputSmoothingSettings({ enabled: nextEnabled, delayMs: nextDelayMs });
      } catch (error) {
        console.error("Failed to load output smoothing settings", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
      if (saveDelayTimerRef.current !== null) {
        window.clearTimeout(saveDelayTimerRef.current);
      }
    };
  }, []);

  const handleEnabledChange = useCallback(async (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    await persistSettings(nextEnabled, delayMs);
  }, [delayMs, persistSettings]);

  const handleDelayChange = useCallback((value: number) => {
    const nextDelayMs = normalizeOutputSmoothingDelayMs(value);
    setDelayMs(nextDelayMs);
    setCachedOutputSmoothingSettings({ enabled, delayMs: nextDelayMs });

    if (saveDelayTimerRef.current !== null) {
      window.clearTimeout(saveDelayTimerRef.current);
    }

    saveDelayTimerRef.current = window.setTimeout(() => {
      void persistSettings(enabled, nextDelayMs);
    }, 250);
  }, [enabled, persistSettings]);

  if (isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Output Smoothing</h2>
        <div className="flex items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Output Smoothing</h2>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border p-4">
        <div className="space-y-1">
          <Label htmlFor="output-smoothing-enabled" className="font-medium">
            Smooth streamed text output
          </Label>
          <p className="text-xs text-muted-foreground">
            Buffers bursty provider chunks and reveals text at an adaptive character-level pace.
          </p>
        </div>
        <Switch
          id="output-smoothing-enabled"
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          disabled={isSaving}
          aria-label="Smooth streamed text output"
        />
      </div>

      <div className="space-y-4 rounded-md border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="output-smoothing-delay" className="font-medium">
              Smoothing delay
            </Label>
            <p className="text-xs text-muted-foreground">
              Higher values buffer a little longer for a steadier typewriter feel.
            </p>
          </div>
          <div className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {delayMs}ms
          </div>
        </div>
        <input
          id="output-smoothing-delay"
          type="range"
          min={MIN_OUTPUT_SMOOTHING_DELAY_MS}
          max={MAX_OUTPUT_SMOOTHING_DELAY_MS}
          step={20}
          value={delayMs}
          onChange={(event) => handleDelayChange(Number(event.target.value))}
          className="w-full accent-primary"
          aria-label="Output smoothing delay"
        />
        <OutputSmoothingPreview delayMs={delayMs} />
      </div>
    </section>
  );
}
