'use client';

import { memo, useCallback } from 'react';
import type { Parameter } from '@/lib/flow';
import { Socket } from './socket';
import { ParameterControl } from './controls';
import { cn } from '@/lib/utils';

interface ParameterRowProps {
  param: Parameter;
  value: unknown;
  isConnected?: boolean;
  onParamChange: (paramId: string, value: unknown) => void;
  nodeId?: string | null;
}

/**
 * Parameter row - renders a socket, label, and optional control for a single parameter.
 * Handles the hybrid mode logic (hide control when connected).
 * 
 * Socket positioning:
 * - Explicit: socket.side overrides default
 * - Default: input/hybrid → left, output → right
 */
export const ParameterRow = memo(function ParameterRow({ param, value, isConnected, onParamChange, nodeId }: ParameterRowProps) {
  const { mode, socket } = param;
  
  const handleChange = useCallback((v: unknown) => onParamChange(param.id, v), [param.id, onParamChange]);
  
  const showControl = (mode === 'constant') || (mode === 'hybrid' && !isConnected);
  const hasSocket = socket && (mode === 'input' || mode === 'output' || mode === 'hybrid');
  const socketSide = socket?.side ?? (mode === 'output' ? 'right' : 'left');
  const hideLabel = param.type === 'messages';
  
  if (mode === 'input' || mode === 'output') {
    return (
      <div className={cn(
        'relative flex items-center h-7 px-3',
        socketSide === 'right' ? 'justify-end' : 'justify-start'
      )}>
        {hasSocket && socketSide === 'left' && (
          <Socket
            id={param.id}
            type={socket.type}
            side="left"
            mode={mode}
            bidirectional={socket.bidirectional}
            config={socket}
          />
        )}
        <span className="text-xs text-muted-foreground">{param.label}</span>
        {hasSocket && socketSide === 'right' && (
          <Socket
            id={param.id}
            type={socket.type}
            side="right"
            mode={mode}
            bidirectional={socket.bidirectional}
            config={socket}
          />
        )}
      </div>
    );
  }
  
  return (
    <div className="relative flex flex-col gap-1 px-3 py-2">
      {hasSocket && socketSide === 'left' && (
        <Socket
          id={param.id}
          type={socket.type}
          side="left"
          mode={mode}
          bidirectional={socket.bidirectional}
          config={socket}
        />
      )}

      {!hideLabel && (
        <span className="text-xs text-muted-foreground">{param.label}</span>
      )}
      {showControl && (
        <ParameterControl
          param={param}
          value={value}
          onChange={handleChange}
          nodeId={nodeId}
        />
      )}
      
      {hasSocket && socketSide === 'right' && (
        <Socket
          id={param.id}
          type={socket.type}
          side="right"
          mode={mode}
          bidirectional={socket.bidirectional}
          config={socket}
        />
      )}
    </div>
  );
});
