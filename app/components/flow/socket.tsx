'use client';

import { memo, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { SocketTypeId, SocketShape, SocketConfig, ParameterMode } from '@/lib/flow';
import { getSocketStyle } from '@/lib/flow';
import { cn } from '@/lib/utils';

const SIZE = 14;
const HALF = SIZE / 2;
const BORDER = 2;

const SHAPES: Record<SocketShape, (fill: string) => ReactNode> = {
  circle: (fill) => (
    <circle cx={HALF} cy={HALF} r={5} fill={fill} strokeWidth={BORDER} />
  ),
  square: (fill) => (
    <rect x={2} y={2} width={10} height={10} rx={2} fill={fill} strokeWidth={BORDER} />
  ),
  diamond: (fill) => (
    <polygon points={`${HALF},1 ${SIZE - 1},${HALF} ${HALF},${SIZE - 1} 1,${HALF}`} fill={fill} strokeWidth={BORDER} />
  ),
};

interface SocketProps {
  id: string;
  type: SocketTypeId;
  side: 'left' | 'right';
  mode: ParameterMode;
  bidirectional?: boolean;
  config?: SocketConfig;
  className?: string;
}

export const Socket = memo(function Socket({ id, type, side, mode, bidirectional, config, className }: SocketProps) {
  const style = getSocketStyle(type, { color: config?.color, shape: config?.shape });
  const handlePosition = side === 'left' ? Position.Left : Position.Right;
  const handleType: 'source' | 'target' =
    bidirectional || mode === 'output' ? 'source' : 'target';

  return (
    <Handle
      id={id}
      type={handleType}
      position={handlePosition}
      className={cn('!w-3.5 !h-3.5 !bg-transparent !border-none', className)}
      style={{ background: 'transparent' }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 pointer-events-none"
        style={{ stroke: 'var(--card)' }}
      >
        {(SHAPES[style.shape] ?? SHAPES.circle)(style.color)}
      </svg>
    </Handle>
  );
});
