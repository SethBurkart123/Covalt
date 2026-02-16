'use client';

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { SOCKET_TYPES, type SocketTypeId } from '@/lib/flow';
import { cn } from '@/lib/utils';

interface RerouteNodeData {
  _socketType?: unknown;
}

const NODE_SIZE = 18;

export const RerouteNode = memo(function RerouteNode({ data, selected }: NodeProps<RerouteNodeData>) {
  const socketType = useMemo<SocketTypeId>(() => {
    const raw = data?._socketType;
    if (typeof raw === 'string' && raw in SOCKET_TYPES) {
      return raw as SocketTypeId;
    }
    return 'data';
  }, [data]);

  const color = SOCKET_TYPES[socketType]?.color ?? '#94a3b8';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full cursor-grab active:cursor-grabbing',
        selected ? 'ring-2 ring-primary' : 'ring-1 ring-border'
      )}
      style={{ width: NODE_SIZE, height: NODE_SIZE, background: 'var(--card)' }}
    >
      <div
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: color }}
      />

      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-transparent !border-none"
        style={{ background: 'transparent' }}
      />
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-transparent !border-none"
        style={{ background: 'transparent' }}
      />
    </div>
  );
});
