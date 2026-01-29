import { useId, ComponentProps } from "react"
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  const id = useId().replace(/:/g, '')
  
  return (
    <>
      <style>{`
        @keyframes shimmer-${id} {
          0% {
            transform: translateX(-100%) skewX(-15deg);
          }
          100% {
            transform: translateX(200%) skewX(-15deg);
          }
        }
        
        .skeleton-${id}::before {
          animation: shimmer-${id} 2s infinite;
        }
      `}</style>
      <div
        data-slot="skeleton"
        className={cn(
          "relative overflow-hidden rounded-md",
          "bg-muted dark:bg-muted/20",
          `skeleton-${id}`,
          "before:absolute before:inset-0",
          "before:bg-gradient-to-r",
          "before:from-transparent",
          "before:via-primary/20 dark:before:via-primary/10",
          "before:to-transparent",
          className
        )}
        {...props}
      />
    </>
  )
}

export { Skeleton }
