"use client";

import React, { useEffect, useState } from "react";
import { Wrench, Loader2 } from "lucide-react";
import { getAvailableTools } from "@/python/api";
import type { ToolInfo } from "@/lib/types/chat";

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTools = async () => {
      try {
        const response = await getAvailableTools();
        setTools(response.tools);
      } catch (error) {
        console.error("Failed to load tools:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTools();
  }, []);

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Tools</h1>
        <p className="text-muted-foreground">
          Available tools for your AI agents. Tool configuration coming soon!
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="border border-border rounded-lg p-4 bg-card hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  <Wrench className="size-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{tool.name || tool.id}</h3>
                    {tool.category && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {tool.category}
                      </span>
                    )}
                  </div>
                  {tool.description && (
                    <p className="text-sm text-muted-foreground">
                      {tool.description}
                    </p>
                  )}
                  <div className="mt-2 text-xs font-mono text-muted-foreground">
                    ID: {tool.id}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {tools.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Wrench className="size-12 mx-auto mb-4 opacity-50" />
              <p>No tools available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

