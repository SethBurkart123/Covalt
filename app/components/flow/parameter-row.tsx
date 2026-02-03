'use client';

import type { Parameter } from '@/lib/flow';
import { Socket } from './socket';
import { ParameterControl } from './controls';
import { cn } from '@/lib/utils';

interface ParameterRowProps {
  param: Parameter;
  value: unknown;
  isConnected?: boolean;
  onChange: (value: unknown) => void;
}

/**
 * Parameter row - renders a socket, label, and optional control for a single parameter.
 * Handles the hybrid mode logic (hide control when connected).
 * 
 * Socket positioning:
 * - Explicit: socket.side overrides default
 * - Default: input/hybrid → left, output → right
 */
export function ParameterRow({ param, value, isConnected, onChange }: ParameterRowProps) {
  const { mode, socket } = param;
  
  // Determine if we should show the control
  const showControl = (mode === 'constant') || (mode === 'hybrid' && !isConnected);
  
  // Determine socket side: explicit override or derive from mode
  const hasSocket = socket && (mode === 'input' || mode === 'output' || mode === 'hybrid');
  const socketSide = socket?.side ?? (mode === 'output' ? 'right' : 'left');
  
  // For pure input/output, show socket + label
  if (mode === 'input' || mode === 'output') {
    const isRightAligned = socketSide === 'right';
    
    return (
      <div className={cn(
        'relative flex items-center h-7 px-3',
        isRightAligned ? 'justify-end' : 'justify-start'
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
  
  // For constant/hybrid modes - show label above control
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
      
      {showControl && (
        <>
          <span className="text-xs text-muted-foreground">{param.label}</span>
          <ParameterControl
            param={param}
            value={value}
            onChange={onChange}
          />
        </>
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
}
