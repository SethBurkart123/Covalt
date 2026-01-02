"use client";

import * as React from "react";
import { getBaseUrl } from "@/python/_internal";

// ============ Types ============

export interface McpServerStatus {
  id: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  error?: string | null;
  toolCount: number;
}

interface McpServersSnapshot {
  servers: McpServerStatus[];
}

// ============ Helpers ============

/**
 * Convert snake_case to camelCase for a single key
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert object keys from snake_case to camelCase
 */
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

// ============ Context ============

interface WebSocketContextType {
  /** Current WebSocket connection status */
  status: WebSocketStatus;
  /** All MCP servers with their current status */
  mcpServers: McpServerStatus[];
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** Manually reconnect the WebSocket */
  reconnect: () => void;
}

const WebSocketContext = React.createContext<WebSocketContextType | undefined>(
  undefined
);

// ============ Provider ============

const RECONNECT_DELAY = 3000; // 3 seconds
const PING_INTERVAL = 30000; // 30 seconds

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<WebSocketStatus>("disconnected");
  const [mcpServers, setMcpServers] = React.useState<McpServerStatus[]>([]);

  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const mountedRef = React.useRef(true);

  const connect = React.useCallback(() => {
    // Don't connect if already connected or connecting
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

        // Start ping interval to keep connection alive
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

  const handleMessage = React.useCallback(
    (message: { event: string; data: unknown }) => {
      switch (message.event) {
        case "mcp_servers": {
          // Full snapshot of all servers (convert snake_case to camelCase)
          const snapshot = convertKeysToCamelCase<McpServersSnapshot>(
            message.data
          );
          setMcpServers(snapshot.servers);
          break;
        }
        case "mcp_status": {
          // Single server status update (convert snake_case to camelCase)
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
        default:
          console.log("[WebSocket] Unknown event:", message.event);
      }
    },
    []
  );

  const cleanup = React.useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const scheduleReconnect = React.useCallback(() => {
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

  const reconnect = React.useCallback(() => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    // Connect immediately
    connect();
  }, [connect, cleanup]);

  // Connect on mount
  React.useEffect(() => {
    mountedRef.current = true;

    // Small delay to ensure bridge is initialized
    const timeout = setTimeout(() => {
      try {
        getBaseUrl(); // Will throw if not initialized
        connect();
      } catch {
        // Bridge not initialized yet, retry later
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

  const value = React.useMemo<WebSocketContextType>(
    () => ({
      status,
      mcpServers,
      isConnected: status === "connected",
      reconnect,
    }),
    [status, mcpServers, reconnect]
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ============ Hooks ============

export function useWebSocket() {
  const context = React.useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}

/**
 * Hook to get MCP server status.
 * Convenience wrapper around useWebSocket for MCP-specific use cases.
 */
export function useMcpStatus() {
  const { mcpServers, isConnected } = useWebSocket();
  return { mcpServers, isConnected };
}

