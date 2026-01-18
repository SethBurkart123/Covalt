"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { getBaseUrl } from "@/python/_internal";

export interface McpServerStatus {
  id: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  error?: string | null;
  toolCount: number;
}

interface McpServersSnapshot {
  servers: McpServerStatus[];
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeysToCamelCase<T>(obj: unknown): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeysToCamelCase<T>(item)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = snakeToCamel(key);
      converted[camelKey] = convertKeysToCamelCase(value);
    }
    return converted as T;
  }
  return obj as T;
}

type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

type WorkspaceFilesChangedCallback = (
  chatId: string,
  changedPaths: string[],
  deletedPaths: string[]
) => void;

interface WebSocketContextType {
  status: WebSocketStatus;
  mcpServers: McpServerStatus[];
  isConnected: boolean;
  reconnect: () => void;
  onWorkspaceFilesChanged: (callback: WorkspaceFilesChangedCallback) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

const RECONNECT_DELAY = 3000;
const PING_INTERVAL = 30000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const workspaceCallbacksRef = useRef<Set<WorkspaceFilesChangedCallback>>(new Set());

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    try {
      const baseUrl = getBaseUrl().replace(/^http/, "ws");
      const ws = new WebSocket(`${baseUrl}/ws/events`);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        if (!mountedRef.current) return;
        console.log("[WebSocket] Connected to events");
        setStatus("connected");

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: "ping", data: {} }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error("[WebSocket] Failed to parse message:", e);
        }
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        console.log("[WebSocket] Disconnected:", event.code, event.reason);
        setStatus("disconnected");
        cleanup();
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        if (!mountedRef.current) return;
        console.error("[WebSocket] Error:", error);
        setStatus("error");
      };
    } catch (e) {
      console.error("[WebSocket] Failed to connect:", e);
      setStatus("error");
      scheduleReconnect();
    }
  }, []);

  const handleMessage = useCallback(
    (message: { event: string; data: unknown }) => {
      switch (message.event) {
        case "mcp_servers": {
          const snapshot = convertKeysToCamelCase<McpServersSnapshot>(
            message.data
          );
          setMcpServers(snapshot.servers);
          break;
        }
        case "mcp_status": {
          const update = convertKeysToCamelCase<McpServerStatus>(message.data);
          setMcpServers((prev) => {
            const existing = prev.find((s) => s.id === update.id);
            if (existing) {
              return prev.map((s) => (s.id === update.id ? update : s));
            }
            return [...prev, update];
          });
          break;
        }
        case "workspace_files_changed": {
          const data = convertKeysToCamelCase<{
            chatId: string;
            changedPaths: string[];
            deletedPaths: string[];
          }>(message.data);
          workspaceCallbacksRef.current.forEach((cb) =>
            cb(data.chatId, data.changedPaths, data.deletedPaths)
          );
          break;
        }
        default:
          console.log("[WebSocket] Unknown event:", message.event);
      }
    },
    []
  );

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        console.log("[WebSocket] Attempting reconnect...");
        connect();
      }
    }, RECONNECT_DELAY);
  }, [connect]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    connect();
  }, [connect, cleanup]);

  const onWorkspaceFilesChanged = useCallback(
    (callback: WorkspaceFilesChangedCallback) => {
      workspaceCallbacksRef.current.add(callback);
      return () => {
        workspaceCallbacksRef.current.delete(callback);
      };
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;

    const timeout = setTimeout(() => {
      try {
        getBaseUrl();
        connect();
      } catch {
        scheduleReconnect();
      }
    }, 100);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeout);
      cleanup();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, cleanup, scheduleReconnect]);

  const value = useMemo<WebSocketContextType>(
    () => ({
      status,
      mcpServers,
      isConnected: status === "connected",
      reconnect,
      onWorkspaceFilesChanged,
    }),
    [status, mcpServers, reconnect, onWorkspaceFilesChanged]
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}

export function useMcpStatus() {
  const { mcpServers, isConnected } = useWebSocket();
  return { mcpServers, isConnected };
}

