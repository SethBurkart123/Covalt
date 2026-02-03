'use client';

import { Handle, Position } from '@xyflow/react';
import type { SocketTypeId, SocketConfig, ParameterMode } from '@/lib/flow';
import { getSocketStyle } from '@/lib/flow';
import { cn } from '@/lib/utils';

interface SocketProps {
  id: string;
  type: SocketTypeId;
  side: 'left' | 'right';     // Visual position
  mode: ParameterMode;         // For determining handle type
  bidirectional?: boolean;     // Can initiate connections (renders as source)
  config?: SocketConfig;
  className?: string;
}

/**
 * Socket component - renders a React Flow Handle with the appropriate shape and color.
 * 
 * Handle type logic:
 * - bidirectional → 'source' (can drag from it, loose mode allows receiving)
 * - mode === 'output' → 'source'
 * - else → 'target'
 */
export function Socket({ id, type, side, mode, bidirectional, config, className }: SocketProps) {
  const style = getSocketStyle(type, { color: config?.color, shape: config?.shape });
  const handlePosition = side === 'left' ? Position.Left : Position.Right;
  
  // Determine handle type - decoupled from visual position
  let handleType: 'source' | 'target';
  if (bidirectional) {
    handleType = 'source';  // Bidirectional can initiate connections
  } else if (mode === 'output') {
    handleType = 'source';
  } else {
    handleType = 'target';  // input/hybrid/constant are targets
  }
  
  // Shape-specific classes
  const shapeClasses = {
    circle: 'rounded-full',
    square: 'rounded-sm',
    diamond: 'rounded-sm rotate-45',
  };
  
  return (
    <Handle
      id={id}
      type={handleType}
      position={handlePosition}
      className={cn(
        '!w-3 !h-3 !border-2 !border-card',
        shapeClasses[style.shape],
        className
      )}
      style={{ backgroundColor: style.color }}
    />
  );
}
