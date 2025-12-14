"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";

interface ThinkingTagPromptProps {
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}

export default function ThinkingTagPrompt({
  onAccept,
  onDecline,
  onDismiss,
}: ThinkingTagPromptProps) {
  return (
    <div className="fixed bottom-44 right-6 z-50 w-[420px] animate-in slide-in-from-bottom-5 duration-300">
      <Item variant="outline" className="shadow-lg bg-background border-border">
        <ItemContent>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <ItemTitle>Thinking tags detected 🤔</ItemTitle>
              <ItemDescription>
                We noticed this model uses{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  &lt;think&gt;
                </code>{" "}
                tags. Would you like us to automatically parse and display them
                for you?
              </ItemDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-muted"
              onClick={onDismiss}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </ItemContent>
        <ItemActions className="w-full pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDecline}
            className="flex-1"
          >
            No thanks
          </Button>
          <Button size="sm" onClick={onAccept} className="flex-1">
            Yes, parse them
          </Button>
        </ItemActions>
      </Item>
    </div>
  );
}
