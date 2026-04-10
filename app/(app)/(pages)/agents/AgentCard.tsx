"use client";

import { memo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  MoreHorizontal,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentInfo } from "@/python/api";
import { agentFileUrl } from "@/python/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import * as LucideIcons from "lucide-react";
import { parseAgentIcon } from "./icon-contract";

interface AgentCardProps {
  agent: AgentInfo;
  onDelete: (id: string) => void;
}

function withCacheKey(url: string, cacheKey?: string): string {
  if (!cacheKey) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(cacheKey)}`;
}

function AgentIconImage({
  agentId,
  cacheKey,
}: {
  agentId: string;
  cacheKey?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <Bot className="size-8 text-muted-foreground" />;
  }

  return (
    <img
      src={withCacheKey(agentFileUrl({ agentId, fileType: "icon" }), cacheKey)}
      className="size-8 rounded object-cover"
      alt=""
      onError={() => setHasError(true)}
    />
  );
}

function AgentIcon({
  icon,
  agentId,
  cacheKey,
}: {
  icon: string | null | undefined;
  agentId: string;
  cacheKey?: string;
}) {
  const { type, value } = parseAgentIcon(icon);

  if (type === "emoji") {
    return <span className="text-2xl">{value}</span>;
  }

  if (type === "lucide") {
    const IconComponent = (
      LucideIcons as unknown as Record<string, LucideIcon>
    )[value];
    if (IconComponent) {
      return <IconComponent className="size-4 text-muted-foreground" />;
    }
  }

  if (type === "image") {
    return <AgentIconImage agentId={agentId} cacheKey={cacheKey} />;
  }
  return <Bot className="size-8 text-muted-foreground" />;
}

function AgentPreview({ agent }: { agent: AgentInfo }) {
  const [hasError, setHasError] = useState(false);

  const showFallback = !agent.previewImage || hasError;
  const cacheKey = agent.updatedAt;

  return (
    <div className="aspect-video relative flex items-center justify-center rounded-b-xl bg-background overflow-clip">
      {showFallback ? (
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <AgentIcon icon={agent.icon} agentId={agent.id} cacheKey={cacheKey} />
        </div>
      ) : (
        <img
          src={withCacheKey(
            agentFileUrl({ agentId: agent.id, fileType: "preview" }),
            cacheKey,
          )}
          alt={`${agent.name} preview`}
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
}

function AgentCardComponent({ agent, onDelete }: AgentCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/agents/edit?id=${agent.id}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(agent.id);
  };

  return (
    <div className="group relative">
      <button
        onClick={handleClick}
        className={cn(
          "w-full rounded-lg border-2 overflow-hidden transition-all text-left",
          "border-transparent bg-sidebar dark:bg-card hover:bg-accent/50 hover:border-transparent dark:hover:bg-border hover:shadow-md",
        )}
      >
        <AgentPreview agent={agent} />
        <div className="flex items-start gap-2 px-2 py-1.5">
          <div className="shrink-0 size-6 flex items-center justify-center">
            <AgentIcon icon={agent.icon} agentId={agent.id} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate">{agent.name}</h3>
            {agent.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {agent.description}
              </p>
            )}
          </div>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity size-8 bg-background/80 backdrop-blur-sm hover:bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleClick}>
            <Pencil className="size-4 mr-2" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const AgentCard = memo(AgentCardComponent);
