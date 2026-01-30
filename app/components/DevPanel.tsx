"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useStreaming } from "@/contexts/streaming-context";
import { useTools } from "@/contexts/tools-context";
import { useChat } from "@/contexts/chat-context";

interface DevPanelProps {
  isLoading: boolean;
  canSendMessage: boolean;
}

function BoolValue({ value, label }: { value: boolean; label: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-400">{label}</span>
      <span className={value ? "text-emerald-400" : "text-zinc-500"}>
        {value ? "true" : "false"}
      </span>
    </div>
  );
}

function StatusValue({ status }: { status: string }) {
  const colors: Record<string, string> = {
    streaming: "text-blue-400",
    paused_hitl: "text-amber-400",
    completed: "text-emerald-400",
    error: "text-red-400",
    interrupted: "text-orange-400",
  };

  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-400">status</span>
      <span className={colors[status] ?? "text-zinc-500"}>{status ?? "idle"}</span>
    </div>
  );
}

export function DevPanel({ isLoading, canSendMessage }: DevPanelProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const { chatId } = useChat();
  const { getStreamState } = useStreaming();
  const { activeToolIds } = useTools();

  const streamState = chatId ? getStreamState(chatId) : undefined;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      setIsVisible((v) => !v);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!isVisible) return null;

  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="fixed bottom-4 right-4 z-[9999] select-none"
    >
      <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg shadow-2xl font-mono text-xs">
        <div className="px-3 py-1.5 border-b border-zinc-700 cursor-grab active:cursor-grabbing flex items-center justify-between">
          <span className="text-zinc-300 font-semibold">Dev</span>
          <button
            onClick={() => setIsVisible(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors ml-4"
          >
            ×
          </button>
        </div>

        <div className="px-3 py-2 space-y-0.5 min-w-[180px]">
          <BoolValue label="isStreaming" value={streamState?.isStreaming ?? false} />
          <StatusValue status={streamState?.status ?? "idle"} />
          <BoolValue label="isPaused" value={streamState?.isPausedForApproval ?? false} />
          <BoolValue label="isLoading" value={isLoading} />
          <BoolValue label="canSend" value={canSendMessage} />

          <div className="flex justify-between gap-4 pt-1 border-t border-zinc-800 mt-1">
            <span className="text-zinc-400">tools</span>
            <button
              onClick={() => setShowTools((s) => !s)}
              className="text-zinc-300 hover:text-white transition-colors"
            >
              {activeToolIds.length} active {showTools ? "▴" : "▾"}
            </button>
          </div>

          {showTools && activeToolIds.length > 0 && (
            <div className="text-zinc-500 text-[10px] pl-2 max-h-24 overflow-y-auto">
              {activeToolIds.map((id) => (
                <div key={id} className="truncate">{id}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
