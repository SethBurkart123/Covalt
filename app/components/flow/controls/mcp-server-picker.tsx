'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { CheckIcon, ChevronDownIcon, Loader2, KeyRound, Plug, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMcpStatus, type McpServerStatus } from '@/contexts/websocket-context';
import {
  startMcpOauth,
  getMcpOauthStatus,
  reconnectMcpServer,
} from '@/python/api';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ControlProps } from './';

interface McpServerPickerProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

function getStatusIcon(status: McpServerStatus['status']) {
  switch (status) {
    case 'connected':
      return <Plug className="size-3 text-emerald-500" />;
    case 'connecting':
      return <Loader2 className="size-3 text-amber-500 animate-spin" />;
    case 'requires_auth':
      return <KeyRound className="size-3 text-primary" />;
    case 'error':
    case 'disconnected':
      return <AlertCircle className="size-3 text-muted-foreground" />;
    default:
      return <Plug className="size-3 text-muted-foreground" />;
  }
}

export function McpServerPicker({ value, onChange, compact }: McpServerPickerProps) {
  const [open, setOpen] = useState(false);
  const { mcpServers } = useMcpStatus();
  const [authenticatingId, setAuthenticatingId] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollOauthStatus = useCallback(async (serverId: string) => {
    try {
      const status = await getMcpOauthStatus({ body: { id: serverId } });
      if (status.status === 'authenticated') {
        stopPolling();
        await reconnectMcpServer({ body: { id: serverId } });
        setAuthenticatingId(null);
      } else if (status.status === 'error') {
        stopPolling();
        setAuthenticatingId(null);
      }
    } catch (error) {
      stopPolling();
      setAuthenticatingId(null);
      console.error('OAuth status polling failed:', error);
    }
  }, [stopPolling]);

  const handleAuthenticate = useCallback(async (server: McpServerStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const serverUrl = server.config?.url;
    if (!serverUrl) return;

    setAuthenticatingId(server.id);
    stopPolling();

    try {
      const result = await startMcpOauth({
        body: { serverId: server.id, serverUrl },
      });

      if (!result.success || !result.authUrl) {
        setAuthenticatingId(null);
        return;
      }

      const width = 600, height = 800;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      window.open(
        result.authUrl,
        'Authenticate',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      pollIntervalRef.current = setInterval(() => {
        void pollOauthStatus(server.id);
      }, 2000);

      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setAuthenticatingId(null);
      }, 5 * 60 * 1000);
    } catch (error) {
      console.error('Failed to start OAuth:', error);
      setAuthenticatingId(null);
    }
  }, [pollOauthStatus, stopPolling]);

  const connectedServers = mcpServers.filter(s => s.status === 'connected');
  const authRequiredServers = mcpServers.filter(s => s.status === 'requires_auth');
  const otherServers = mcpServers.filter(s => 
    s.status !== 'connected' && s.status !== 'requires_auth'
  );

  const selectedServer = mcpServers.find(s => s.id === value);
  const hasNoServers = mcpServers.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'nodrag justify-between bg-secondary border border-border hover:bg-secondary/80 hover:border-border/80 text-secondary-foreground',
            compact ? 'h-7 text-xs px-2 w-full' : 'h-8 text-sm px-2 w-full'
          )}
        >
          {selectedServer ? (
            <span className="flex items-center gap-1.5 min-w-0">
              {getStatusIcon(selectedServer.status)}
              <span className="truncate">{selectedServer.id}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select server...</span>
          )}
          <ChevronDownIcon size={compact ? 12 : 14} className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 border-border bg-popover"
        align="start"
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search servers..." className="border-border" />
          <CommandList className="max-h-64">
            {hasNoServers ? (
              <CommandEmpty>No MCP servers configured.</CommandEmpty>
            ) : (
              <CommandEmpty>No matching servers.</CommandEmpty>
            )}
            
            {connectedServers.length > 0 && (
              <CommandGroup heading="Connected">
                {connectedServers.map((server) => (
                  <CommandItem
                    key={server.id}
                    value={server.id}
                    onSelect={() => {
                      onChange(server.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      {getStatusIcon(server.status)}
                      <span className="truncate">{server.id}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {server.toolCount} tools
                      </span>
                    </span>
                    {server.id === value && (
                      <CheckIcon size={14} className="shrink-0 ml-2" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            
            {authRequiredServers.length > 0 && (
              <CommandGroup heading="Needs Authentication">
                {authRequiredServers.map((server) => {
                  const isAuthenticating = authenticatingId === server.id;
                  const showOauthButton = server.authHint !== 'token';
                  
                  return (
                    <CommandItem
                      key={server.id}
                      value={server.id}
                      className="cursor-default flex items-center justify-between"
                      onSelect={() => {}}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {getStatusIcon(server.status)}
                        <span className="truncate">{server.id}</span>
                      </span>
                      {showOauthButton && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-6 text-xs px-2 ml-2"
                          disabled={isAuthenticating}
                          onClick={(e) => handleAuthenticate(server, e)}
                        >
                          {isAuthenticating ? (
                            <>
                              <Loader2 className="size-3 animate-spin mr-1" />
                              Waiting...
                            </>
                          ) : (
                            <>
                              <KeyRound className="size-3 mr-1" />
                              Authenticate
                            </>
                          )}
                        </Button>
                      )}
                      {!showOauthButton && (
                        <span className="text-xs text-muted-foreground">
                          Needs token
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            
            {otherServers.length > 0 && (
              <CommandGroup heading="Unavailable">
                {otherServers.map((server) => (
                  <CommandItem
                    key={server.id}
                    value={server.id}
                    disabled
                    className="opacity-50"
                  >
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      {getStatusIcon(server.status)}
                      <span className="truncate">{server.id}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {server.status === 'connecting' ? 'Connecting...' : server.status}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
