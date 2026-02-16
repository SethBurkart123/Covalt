"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useFlowRunner, usePromptDefaults, getPromptTitle } from "@/lib/flow/use-flow-runner";

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseHistoryJson(raw: string): { value?: Record<string, unknown>[]; error?: string } {
  if (!raw.trim()) return { value: undefined };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { error: "History must be a JSON array." };
    }
    return { value: parsed as Record<string, unknown>[] };
  } catch {
    return { error: "History must be valid JSON." };
  }
}

export function FlowRunPrompt() {
  const {
    promptState,
    closePrompt,
    submitPrompt,
    getPromptNode,
    isRunning,
    setPromptTriggerId,
  } = useFlowRunner();
  const promptDefaults = usePromptDefaults();
  const node = getPromptNode();

  const [message, setMessage] = useState("");
  const [historyJson, setHistoryJson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => getPromptTitle(node, promptState.mode), [node, promptState.mode]);
  const showTriggerSelection = promptState.triggerOptions.length > 1;
  const useTriggerDropdown = promptState.triggerOptions.length > 3;
  const description = "Provide the input used for this run. This does not affect production runs.";

  useEffect(() => {
    if (!promptState.open) return;
    setMessage(promptDefaults.message);
    setHistoryJson(promptDefaults.history.length ? formatJson(promptDefaults.history) : "");
    setError(null);
  }, [promptState.open, promptDefaults]);

  const handleSubmit = useCallback(async () => {
    const parsed = parseHistoryJson(historyJson);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }

    setError(null);
    const submitPromise = submitPrompt({
      message,
      history: parsed.value,
    });
    closePrompt();
    await submitPromise;
  }, [closePrompt, historyJson, message, submitPrompt]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      handleSubmit();
    },
    [handleSubmit]
  );

  return (
    <Dialog open={promptState.open} onOpenChange={(open) => { if (!open) closePrompt(); }}>
      <DialogContent className="sm:max-w-[520px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {showTriggerSelection && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Trigger source</label>
              {useTriggerDropdown ? (
                <Select
                  value={promptState.selectedTriggerId ?? undefined}
                  onValueChange={setPromptTriggerId}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder="Select trigger" />
                  </SelectTrigger>
                  <SelectContent>
                    {promptState.triggerOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-1">
                  {promptState.triggerOptions.map((option) => {
                    const selected = option.id === promptState.selectedTriggerId;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPromptTriggerId(option.id)}
                        className={cn(
                          "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                          selected
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional message for chat-start"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">History (JSON)</label>
              <Textarea
                value={historyJson}
                onChange={(e) => setHistoryJson(e.target.value)}
                placeholder='[{"role":"user","content":"Hello"}]'
                rows={6}
              />
            </div>
          </>

          {error && (
            <div className="text-xs text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={closePrompt} disabled={isRunning}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isRunning}>
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
