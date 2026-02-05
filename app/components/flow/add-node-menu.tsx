'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { SearchIcon, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNodesByCategory, getCompatibleNodeSockets } from '@/lib/flow/nodes';
import type { NodeDefinition, SocketTypeId } from '@/lib/flow';

export interface ConnectionFilter {
  socketType: SocketTypeId;
  needsInput: boolean;
}

interface AddNodeMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  onSelect: (nodeType: string) => void;
  connectionFilter?: ConnectionFilter;
  onSelectWithSocket?: (nodeType: string, socketId: string) => void;
}

interface HoveredItem {
  name: string;
  description?: string;
}

const CATEGORIES: { id: NodeDefinition['category']; label: string }[] = [
  { id: 'core', label: 'Core' },
  { id: 'tools', label: 'Tools' },
  { id: 'data', label: 'Data' },
  { id: 'utility', label: 'Utility' },
];

function getCategoryLabel(category: NodeDefinition['category']) {
  return CATEGORIES.find(c => c.id === category)?.label ?? category;
}

const MENU_OFFSET_Y = 20;

export function AddNodeMenu({ 
  isOpen, 
  onClose, 
  position, 
  onSelect,
  connectionFilter,
  onSelectWithSocket,
}: AddNodeMenuProps) {
  const [mode, setMode] = useState<'browse' | 'search'>('browse');
  const [search, setSearch] = useState('');
  const [hoveredCategory, setHoveredCategory] = useState<NodeDefinition['category'] | null>(null);
  const [hoveredItem, setHoveredItem] = useState<HoveredItem | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compatibleSockets = useMemo(() => {
    if (!connectionFilter) return null;
    return getCompatibleNodeSockets(connectionFilter.socketType, connectionFilter.needsInput);
  }, [connectionFilter]);

  const nodesByCategory = useMemo(() => {
    if (compatibleSockets) {
      const grouped = new Map<NodeDefinition['category'], typeof compatibleSockets>();
      for (const item of compatibleSockets) {
        const list = grouped.get(item.nodeCategory) ?? [];
        list.push(item);
        grouped.set(item.nodeCategory, list);
      }
      return grouped;
    }
    
    const grouped = new Map<NodeDefinition['category'], ReturnType<typeof getNodesByCategory>>();
    for (const { id } of CATEGORIES) {
      const nodes = getNodesByCategory(id);
      if (nodes.length > 0) grouped.set(id, nodes);
    }
    return grouped;
  }, [compatibleSockets]);

  const flatItems = useMemo(() => {
    if (compatibleSockets) {
      return compatibleSockets.map(item => ({
        id: `${item.nodeId}-${item.socketId}`,
        category: item.nodeCategory,
        name: item.nodeName,
        socketLabel: item.socketLabel,
        nodeId: item.nodeId,
        socketId: item.socketId,
        description: undefined as string | undefined,
      }));
    }
    
    return CATEGORIES.flatMap(({ id }) => 
      getNodesByCategory(id).map(node => ({
        id: node.id,
        category: id,
        name: node.name,
        nodeId: node.id,
        socketId: undefined as string | undefined,
        socketLabel: undefined as string | undefined,
        description: node.description,
      }))
    );
  }, [compatibleSockets]);

  const filteredItems = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return flatItems;
    
    return flatItems.filter(item =>
      item.name.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.socketLabel?.toLowerCase().includes(query)
    );
  }, [flatItems, search]);

  const handleSelectNode = useCallback(
    (nodeId: string, socketId?: string) => {
      if (socketId && onSelectWithSocket) {
        onSelectWithSocket(nodeId, socketId);
      } else {
        onSelect(nodeId);
      }
      setSearch('');
      setMode('browse');
      onClose();
    },
    [onSelect, onSelectWithSocket, onClose]
  );

  const handleCategoryEnter = useCallback((category: NodeDefinition['category'], element: HTMLDivElement) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    categoryRefs.current.set(category, element);
    const rect = element.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect();
    if (menuRect) {
      setSubmenuTop(rect.top - menuRect.top);
    }
    setHoveredCategory(category);
  }, []);

  const handleCategoryLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCategory(null);
    }, 100);
  }, []);

  const handleSubmenuEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  }, []);

  const handleSubmenuLeave = useCallback(() => {
    setHoveredCategory(null);
  }, []);

  const openSearch = useCallback(() => {
    setMode('search');
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setMode('browse');
      setHoveredCategory(null);
      setHoveredItem(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'search') {
          setMode('browse');
          setSearch('');
        } else {
          onClose();
        }
        return;
      }
      
      if (mode === 'browse' && e.key === 'Enter') {
        e.preventDefault();
        setMode('search');
        setTimeout(() => inputRef.current?.focus(), 10);
        return;
      }
      
      if (mode === 'browse' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setMode('search');
        setSearch(e.key);
        setTimeout(() => inputRef.current?.focus(), 10);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, mode]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    const timeoutId = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside, true);
    }, 100);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const hoveredNodes = hoveredCategory ? nodesByCategory.get(hoveredCategory) : null;

  return (
    <div
      ref={menuRef}
      data-add-node-menu
      className="fixed z-50 rounded-md border bg-popover text-popover-foreground shadow-lg"
      style={{ left: position.x - 60, top: position.y - MENU_OFFSET_Y }}
    >
      <div className="absolute -top-5 left-0 px-1 text-[10px] text-muted-foreground">Add Node</div>
      {mode === 'browse' ? (
        <div className="w-44">
          <div
            onClick={openSearch}
            className={cn(
              'flex h-9 cursor-pointer items-center gap-2 rounded-t-md border-b border-border px-3 text-sm',
              'hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <SearchIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Search...</span>
          </div>

          <div className="overflow-hidden rounded-b-md">
            <div className="max-h-80 overflow-y-auto">
              {CATEGORIES.map(({ id, label }) => {
                const nodes = nodesByCategory.get(id);
                if (!nodes || nodes.length === 0) return null;
                
                return (
                  <div
                    key={id}
                    onMouseEnter={(e) => handleCategoryEnter(id, e.currentTarget)}
                    onMouseLeave={handleCategoryLeave}
                    className={cn(
                      'flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm',
                      'hover:bg-accent hover:text-accent-foreground',
                      hoveredCategory === id && 'bg-accent text-accent-foreground'
                    )}
                  >
                    <span>{label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <Command className="flex w-72 flex-col" shouldFilter={false}>
          <div className="flex h-9 items-center gap-2 border-b border-border px-3">
            <SearchIcon className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder="Search nodes..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="overflow-hidden rounded-b-md">
            <Command.List className="max-h-80 overflow-y-auto">
              {filteredItems.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {connectionFilter ? 'No compatible nodes' : 'No nodes found'}
                </div>
              ) : (
                filteredItems.map(item => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    onSelect={() => handleSelectNode(item.nodeId, item.socketId)}
                    onMouseEnter={() => setHoveredItem({ name: item.name, description: item.description })}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm outline-none',
                      'hover:bg-accent hover:text-accent-foreground',
                      'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
                    )}
                  >
                    <span className="text-muted-foreground">{getCategoryLabel(item.category)}</span>
                    <span>
                      {item.name}
                      {item.socketLabel && (
                        <span className="text-muted-foreground"> → {item.socketLabel}</span>
                      )}
                    </span>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </div>
        </Command>
      )}

      {mode === 'browse' && hoveredNodes && (
        <div
          className="absolute left-full top-0 ml-1 rounded-md border bg-popover shadow-lg"
          style={{ top: submenuTop }}
          onMouseEnter={handleSubmenuEnter}
          onMouseLeave={handleSubmenuLeave}
        >
          <div className="w-44 py-1">
            {compatibleSockets ? (
              (hoveredNodes as typeof compatibleSockets).map(item => (
                <div
                  key={`${item.nodeId}-${item.socketId}`}
                  onClick={() => handleSelectNode(item.nodeId, item.socketId)}
                  onMouseEnter={() => setHoveredItem({ name: item.nodeName, description: undefined })}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={cn(
                    'flex cursor-pointer items-center px-3 py-1.5 text-sm',
                    'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {item.nodeName}
                  <span className="ml-1 text-muted-foreground">→ {item.socketLabel}</span>
                </div>
              ))
            ) : (
              (hoveredNodes as ReturnType<typeof getNodesByCategory>).map(node => (
                <div
                  key={node.id}
                  onClick={() => handleSelectNode(node.id)}
                  onMouseEnter={() => setHoveredItem({ name: node.name, description: node.description })}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={cn(
                    'flex cursor-pointer items-center px-3 py-1.5 text-sm',
                    'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {node.name}
                </div>
              ))
            )}
          </div>
          
          {hoveredItem?.description && (
            <div className="border-t border-border p-3">
              <div className="text-xs text-muted-foreground leading-relaxed">{hoveredItem.description}</div>
            </div>
          )}
        </div>
      )}

      {mode === 'search' && hoveredItem?.description && (
        <div 
          className="absolute left-full top-0 ml-1 w-52 rounded-md border bg-popover p-3 shadow-lg"
        >
          <div className="text-sm font-medium">{hoveredItem.name}</div>
          <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{hoveredItem.description}</div>
        </div>
      )}
    </div>
  );
}
