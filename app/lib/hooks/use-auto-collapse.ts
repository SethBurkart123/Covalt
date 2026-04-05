import { useCallback, useEffect, useRef, useState } from "react";

interface UseAutoCollapseOptions {
  active: boolean;
  disabled?: boolean;
}

/**
 * Manages open/close state for collapsible panels that auto-open while active
 * and auto-close (with a delay) when activity ends - unless the user has
 * manually expanded the panel.
 */
export function useAutoCollapse({ active, disabled = false }: UseAutoCollapseOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (disabled) return;

    if (active) {
      setIsManuallyExpanded(false);
      userInteractedRef.current = false;
      setIsClosing(false);

      if (!userInteractedRef.current) {
        setIsOpen(true);
      }
      return;
    }

    if (isOpen && !isManuallyExpanded && !userInteractedRef.current) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setIsOpen(false);
        setIsClosing(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [active, disabled, isOpen, isManuallyExpanded]);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    userInteractedRef.current = true;

    if (active && isOpen && !isManuallyExpanded) {
      setIsManuallyExpanded(true);
    } else {
      setIsOpen(!isOpen);
      if (isOpen) setIsManuallyExpanded(false);
    }
  }, [disabled, active, isOpen, isManuallyExpanded]);

  return {
    isOpen: disabled ? true : isOpen,
    isClosing,
    isManuallyExpanded,
    setIsOpen: disabled ? undefined : setIsOpen,
    handleToggle,
  };
}
