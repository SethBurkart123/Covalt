"use client"

import { createContext, useContext, useState, type HTMLAttributes, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface CollapsibleContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isGrouped: boolean
  isFirst: boolean
  isLast: boolean
  shimmer: boolean
  disableToggle: boolean
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null)

function useCollapsible() {
  const context = useContext(CollapsibleContext)
  if (!context) throw new Error("Collapsible components must be used within a Collapsible")
  return context
}

interface CollapsibleProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isGrouped?: boolean
  isFirst?: boolean
  isLast?: boolean
  shimmer?: boolean
  disableToggle?: boolean
}

function Collapsible({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  shimmer = false,
  disableToggle = false,
  className,
  ...props
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = controlledOpen ?? uncontrolledOpen
  const setIsOpen = onOpenChange ?? setUncontrolledOpen

  const value = { isOpen, setIsOpen, isGrouped, isFirst, isLast, shimmer, disableToggle }

  if (isGrouped) {
    return (
      <CollapsibleContext.Provider value={value}>
        <div className={cn("relative", className)} {...props}>{children}</div>
      </CollapsibleContext.Provider>
    )
  }

  return (
    <CollapsibleContext.Provider value={value}>
      <div className={cn("my-3 not-prose", className)} {...props}>
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          {children}
        </div>
      </div>
    </CollapsibleContext.Provider>
  )
}

interface CollapsibleTriggerProps {
  children: ReactNode
  rightContent?: ReactNode
  className?: string
  onClick?: () => void
  overrideIsOpenPreview?: boolean
}

function CollapsibleTrigger({ children, rightContent, className, onClick, overrideIsOpenPreview }: CollapsibleTriggerProps) {
  const { isOpen, setIsOpen, isGrouped, shimmer, disableToggle } = useCollapsible()

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else if (!disableToggle) {
      setIsOpen(!isOpen)
    }
  }

  const rotation = overrideIsOpenPreview !== undefined 
    ? (overrideIsOpenPreview ? 180 : 0)
    : (isOpen ? 180 : 0)

  return (
    <div
      onClick={handleClick}
      className={cn(
        "w-full px-4 py-3 flex items-center justify-between transition-colors",
        isGrouped ? "hover:bg-border/30" : "hover:bg-muted/50",
        shimmer && "shimmer",
        disableToggle ? "cursor-default" : "cursor-pointer",
        className
      )}
    >
      {children}
      <div className="flex items-center gap-2">
        {rightContent}
        {!disableToggle && (
          <motion.div animate={{ rotate: rotation }} transition={{ duration: 0.2 }}>
            <ChevronDown size={16} className="text-muted-foreground" />
          </motion.div>
        )}
      </div>
    </div>
  )
}

interface CollapsibleIconProps {
  icon: LucideIcon
  className?: string
}

function CollapsibleIcon({ icon: Icon, className }: CollapsibleIconProps) {
  const { isGrouped, isFirst, isLast } = useCollapsible()

  if (isGrouped) {
    return (
      <>
        {(isFirst && isLast) || (isFirst !== isLast) ? (
          <div
            className="absolute left-7 top-0 bottom-0 z-10 w-px bg-border"
            style={{
              top: isFirst ? "2.2rem" : "0",
              bottom: isLast ? "calc(100% - 0.7rem)" : "0",
            }}
          />
        ) : (
          <>
            <div className="absolute left-7 top-0 bottom-0 z-10 w-px bg-border" style={{ top: "2.2rem" }} />
            <div className="absolute left-7 top-0 bottom-0 z-10 w-px bg-border" style={{ bottom: "calc(100% - 0.7rem)" }} />
          </>
        )}
        <div className="size-6 p-0.5 flex justify-center items-center relative z-10">
          <Icon size={16} className={cn("text-muted-foreground", className)} />
        </div>
      </>
    )
  }

  return <Icon size={16} className={cn("text-muted-foreground", className)} />
}

interface CollapsibleHeaderProps {
  children: ReactNode
  className?: string
}

function CollapsibleHeader({ children, className }: CollapsibleHeaderProps) {
  return <div className={cn("flex items-center gap-2", className)}>{children}</div>
}

interface CollapsibleContentProps {
  children: ReactNode
  className?: string
}

function CollapsibleContent({ children, className }: CollapsibleContentProps) {
  const { isOpen, isGrouped, isLast } = useCollapsible()

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 270, damping: 30 }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "px-4 pb-3 space-y-3 pt-3",
              isGrouped ? (isLast ? "border-t border-border" : "") + " pl-9" : "border-t border-border",
              className
            )}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
  useCollapsible,
}