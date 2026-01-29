"use client"

import { createContext, useContext, useState, useEffect } from "react"
import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

type Orientation = "horizontal" | "vertical"

const OrientationContext = createContext<Orientation>("horizontal")

function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <OrientationContext.Provider value={orientation}>
      <ResizablePrimitive.Group
        data-slot="resizable-panel-group"
        orientation={orientation}
        className={cn(
          "flex h-full w-full",
          orientation === "vertical" && "flex-col",
          className
        )}
        {...props}
      />
    </OrientationContext.Provider>
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}) {
  const isVertical = useContext(OrientationContext) === "vertical"
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) return

    const handlePointerUp = () => setIsDragging(false)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)

    return () => {
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [isDragging])

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      data-dragging={isDragging || undefined}
      onPointerDown={() => setIsDragging(true)}
      className={cn(
        "relative flex items-center justify-center",
        isVertical ? "h-0 w-full" : "w-0 h-full",
        "before:absolute before:z-10 before:transition-opacity before:opacity-0 hover:before:opacity-100 data-[dragging]:before:opacity-100",
        isVertical
          ? "before:h-1 before:inset-x-0 before:top-1/2 before:-translate-y-1/2 before:bg-border"
          : "before:w-1 before:inset-y-0 before:left-1/2 before:-translate-x-1/2 before:bg-border",
        "after:absolute",
        isVertical
          ? "after:h-3 after:inset-x-0 after:top-1/2 after:-translate-y-1/2"
          : "after:w-3 after:inset-y-0 after:left-1/2 after:-translate-x-1/2",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className={cn(
          "bg-border z-20 flex h-4 w-3 items-center justify-center rounded-xs border opacity-0 transition-opacity",
          "group-hover:opacity-100 data-[dragging]:opacity-100",
          isVertical && "rotate-90"
        )}>
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
