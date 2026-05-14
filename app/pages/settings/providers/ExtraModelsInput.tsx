
import { useState, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ExtraModelsInputProps {
  models: string[];
  onChange: (models: string[]) => void;
}

export default function ExtraModelsInput({ models, onChange }: ExtraModelsInputProps) {
  const [input, setInput] = useState("");

  const addModel = useCallback(() => {
    const modelId = input.trim();
    if (!modelId || models.includes(modelId)) return;
    onChange([...models, modelId]);
    setInput("");
  }, [input, models, onChange]);

  const removeModel = useCallback(
    (modelId: string) => {
      onChange(models.filter((m) => m !== modelId));
    },
    [models, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addModel();
      }
    },
    [addModel],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="e.g. gpt-4.1-nano"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={addModel}
          disabled={!input.trim()}
          className="h-8 gap-1.5 text-muted-foreground border border-dashed border-border/60 hover:border-border hover:bg-muted/50"
        >
          <Plus size={14} />
          Add
        </Button>
      </div>
      {models.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap">
          <AnimatePresence mode="popLayout">
            {models.map((modelId) => (
              <motion.div
                key={modelId}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <div className="group inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-sm shadow-sm hover:border-border transition-colors">
                  <span className="truncate max-w-[200px] text-foreground/90">
                    {modelId}
                  </span>
                  <button
                    onClick={() => removeModel(modelId)}
                    className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 hover:bg-muted transition-all"
                    aria-label={`Remove ${modelId}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
