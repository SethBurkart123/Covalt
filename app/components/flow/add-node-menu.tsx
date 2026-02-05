'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNodesByCategory, getCompatibleNodeSockets } from '@/lib/flow/nodes';
import type { NodeDefinition, SocketTypeId } from '@/lib/flow';

/** Filter for showing only compatible nodes when dragging from a socket */
export interface ConnectionFilter {
  socketType: SocketTypeId;
  /** If true, we need nodes with INPUT sockets (user dragged from an output) */
  needsInput: boolean;
}

interface AddNodeMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  /** Called when selecting a node (normal mode) */
  onSelect: (nodeType: string) => void;
  /** Optional: filter to show only compatible nodes for a pending connection */
  connectionFilter?: ConnectionFilter;
  /** Called when selecting a node+socket pair (connection mode) */
  onSelectWithSocket?: (nodeType: string, socketId: string) => void;
}

/** Get a Lucide icon component by name */
function getIcon(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (Icons as any)[name];
  return IconComponent ?? Icons.Circle;
}

/** Get category display info */
function getCategoryInfo(category: NodeDefinition['category']) {
  switch (category) {
    case 'core':
      return { label: 'Core', color: 'text-primary' };
    case 'tools':
      return { label: 'Tools', color: 'text-amber-500' };
    case 'data':
      return { label: 'Data', color: 'text-blue-500' };
    case 'utility':
      return { label: 'Utility', color: 'text-muted-foreground' };
    default:
      return { label: category, color: 'text-muted-foreground' };
  }
}

export function AddNodeMenu({ 
  isOpen, 
  onClose, 
  position, 
  onSelect,
  connectionFilter,
  onSelectWithSocket,
}: AddNodeMenuProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Get compatible node+socket pairs when in connection mode
  const compatibleSockets = useMemo(() => {
    if (!connectionFilter) return null;
    return getCompatibleNodeSockets(connectionFilter.socketType, connectionFilter.needsInput);
  }, [connectionFilter]);

  // Group compatible sockets by category (for connection mode)
  const compatibleByCategory = useMemo(() => {
    if (!compatibleSockets) return null;
    
    const categories: NodeDefinition['category'][] = ['core', 'tools', 'data', 'utility'];
    return categories
      .map(category => ({
        category,
        items: compatibleSockets.filter(item => item.nodeCategory === category),
      }))
      .filter(group => group.items.length > 0);
  }, [compatibleSockets]);

  // Group nodes by category (for normal mode)
  const nodesByCategory = useMemo(() => {
    if (connectionFilter) return null; // Don't compute if in connection mode
    
    const categories: NodeDefinition['category'][] = ['core', 'tools', 'data', 'utility'];
    return categories
      .map(category => ({
        category,
        nodes: getNodesByCategory(category),
      }))
      .filter(group => group.nodes.length > 0);
  }, [connectionFilter]);

  // Filter based on search (works for both modes)
  const filteredGroups = useMemo(() => {
    const query = search.toLowerCase().trim();
    
    // Connection mode: filter compatible sockets
    if (compatibleByCategory) {
      if (!query) return compatibleByCategory;
      
      return compatibleByCategory
        .map(group => ({
          ...group,
          items: group.items.filter(
            item =>
              item.nodeName.toLowerCase().includes(query) ||
              item.socketLabel.toLowerCase().includes(query)
          ),
        }))
        .filter(group => group.items.length > 0);
    }
    
    // Normal mode: filter nodes
    if (nodesByCategory) {
      if (!query) return nodesByCategory;
      
      return nodesByCategory
        .map(group => ({
          ...group,
          nodes: group.nodes.filter(
            node =>
              node.name.toLowerCase().includes(query) ||
              node.description?.toLowerCase().includes(query) ||
              node.id.toLowerCase().includes(query)
          ),
        }))
        .filter(group => group.nodes.length > 0);
    }
    
    return [];
  }, [compatibleByCategory, nodesByCategory, search]);

  // Handle selection (normal mode)
  const handleSelect = useCallback(
    (nodeType: string) => {
      onSelect(nodeType);
      setSearch('');
      onClose();
    },
    [onSelect, onClose]
  );

  // Handle selection with socket (connection mode)
  const handleSelectWithSocket = useCallback(
    (nodeType: string, socketId: string) => {
      if (onSelectWithSocket) {
        onSelectWithSocket(nodeType, socketId);
      }
      setSearch('');
      onClose();
    },
    [onSelectWithSocket, onClose]
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure menu is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to avoid immediate close from the trigger click
    const timeoutId = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      data-add-node-menu
      className="fixed z-50 w-72 rounded-md border bg-popover text-popover-foreground shadow-lg"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <Command className="flex flex-col overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center border-b border-border px-3">
          <Icons.SearchIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          <Command.Input
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            placeholder="Search nodes..."
            className="flex h-10 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Node List */}
        <Command.List className="max-h-80 flex-1 overflow-y-auto p-1">
          {filteredGroups.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {connectionFilter ? 'No compatible nodes' : 'No nodes found'}
            </div>
          ) : connectionFilter ? (
            // Connection mode: show node → socket pairs
            (filteredGroups as { category: NodeDefinition['category']; items: ReturnType<typeof getCompatibleNodeSockets> }[]).map(group => {
              const categoryInfo = getCategoryInfo(group.category);
              return (
                <Command.Group
                  key={group.category}
                  heading={
                    <span className={cn('text-xs font-medium', categoryInfo.color)}>
                      {categoryInfo.label}
                    </span>
                  }
                  className="px-1 py-2"
                >
                  {group.items.map(item => {
                    const Icon = getIcon(item.nodeIcon);
                    const key = `${item.nodeId}-${item.socketId}`;
                    return (
                      <Command.Item
                        key={key}
                        value={key}
                        onSelect={() => handleSelectWithSocket(item.nodeId, item.socketId)}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
                          'hover:bg-accent hover:text-accent-foreground',
                          'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {item.nodeName}
                            <span className="text-muted-foreground font-normal"> → {item.socketLabel}</span>
                          </span>
                        </div>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              );
            })
          ) : (
            // Normal mode: show nodes
            (filteredGroups as { category: NodeDefinition['category']; nodes: NodeDefinition[] }[]).map(group => {
              const categoryInfo = getCategoryInfo(group.category);
              return (
                <Command.Group
                  key={group.category}
                  heading={
                    <span className={cn('text-xs font-medium', categoryInfo.color)}>
                      {categoryInfo.label}
                    </span>
                  }
                  className="px-1 py-2"
                >
                  {group.nodes.map(node => {
                    const Icon = getIcon(node.icon);
                    return (
                      <Command.Item
                        key={node.id}
                        value={node.id}
                        onSelect={() => handleSelect(node.id)}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
                          'hover:bg-accent hover:text-accent-foreground',
                          'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{node.name}</span>
                          {node.description && (
                            <span className="text-xs text-muted-foreground line-clamp-1">
                              {node.description}
                            </span>
                          )}
                        </div>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              );
            })
          )}
        </Command.List>
      </Command>
    </div>
  );
}
