'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface DraggableNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}

const DRAG_THRESHOLD_PX = 3;

function getStepDecimals(step: number): number {
  const stepString = step.toString();
  if (stepString.includes('e-')) {
    const [, exp] = stepString.split('e-');
    const expValue = Number(exp);
    return Number.isFinite(expValue) ? expValue : 0;
  }
  const dotIndex = stepString.indexOf('.');
  return dotIndex === -1 ? 0 : stepString.length - dotIndex - 1;
}

export function DraggableNumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
  compact,
  disabled,
}: DraggableNumberInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    startValue: number;
    dragging: boolean;
  } | null>(null);

  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  const hasRange = hasMin && hasMax && (max as number) > (min as number);

  const stepSize = typeof step === 'number' && step > 0 ? step : undefined;
  const stepDecimals = useMemo(() => (stepSize ? getStepDecimals(stepSize) : 0), [stepSize]);

  const dragStep = useMemo(() => {
    if (stepSize) return stepSize;
    if (hasRange) {
      const range = (max as number) - (min as number);
      if (Number.isFinite(range) && range > 0) {
        return range / 100;
      }
    }
    return 0.01;
  }, [stepSize, hasRange, max, min]);

  const clampValue = useCallback(
    (next: number) => {
      let clamped = next;
      if (hasMin) clamped = Math.max(min as number, clamped);
      if (hasMax) clamped = Math.min(max as number, clamped);
      return clamped;
    },
    [hasMin, hasMax, min, max]
  );

  const snapToStep = useCallback(
    (next: number) => {
      if (!stepSize) return next;
      const snapped = Math.round(next / stepSize) * stepSize;
      return stepDecimals > 0 ? Number(snapped.toFixed(stepDecimals)) : Math.round(snapped);
    },
    [stepSize, stepDecimals]
  );

  const coerceValue = useCallback(
    (next: number) => clampValue(snapToStep(next)),
    [clampValue, snapToStep]
  );

  const displayValue = useMemo(() => {
    if (!Number.isFinite(value)) return '';
    if (stepSize) {
      return value.toFixed(stepDecimals);
    }
    return String(value);
  }, [value, stepSize, stepDecimals]);

  const fillPercent = useMemo(() => {
    if (!hasRange) return 0;
    const range = (max as number) - (min as number);
    if (range <= 0) return 0;
    const raw = ((value - (min as number)) / range) * 100;
    return Math.min(100, Math.max(0, raw));
  }, [hasRange, max, min, value]);

  const enterEditMode = useCallback(() => {
    if (disabled) return;
    setDraftValue(displayValue);
    setIsEditing(true);
  }, [displayValue, disabled]);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
  }, []);

  const commitDraft = useCallback(() => {
    const parsed = parseFloat(draftValue);
    if (!Number.isNaN(parsed)) {
      onChange(coerceValue(parsed));
    }
    exitEditMode();
  }, [draftValue, onChange, coerceValue, exitEditMode]);

  useEffect(() => {
    if (!isEditing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditing]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || isEditing || event.button !== 0) return;
      event.preventDefault();
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: event.currentTarget.getBoundingClientRect().width,
        startValue: value,
        dragging: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, isEditing, value]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startX;
      if (!dragState.dragging && Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
        return;
      }

      if (!dragState.dragging) {
        dragState.dragging = true;
        setIsDragging(true);
      }

      const width = dragState.startWidth > 0 ? dragState.startWidth : 1;
      if (hasRange) {
        const range = (max as number) - (min as number);
        const deltaValue = (deltaX / width) * range;
        const next = dragState.startValue + deltaValue;
        onChange(stepSize ? coerceValue(next) : clampValue(next));
        return;
      }

      const deltaSteps = (deltaX / width) * 100;
      const deltaValue = deltaSteps * dragStep;
      const next = dragState.startValue + deltaValue;
      onChange(stepSize ? coerceValue(next) : clampValue(next));
    }, 
    [clampValue, coerceValue, dragStep, hasRange, max, min, onChange, stepSize]
  );

  const endPointerDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (dragState.dragging) {
        setIsDragging(false);
      }

      dragStateRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);

      if (!dragState.dragging) {
        enterEditMode();
      }
    },
    [enterEditMode]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
      setIsDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    []
  );

  return (
    <div
      className={cn(
        'nodrag relative w-full overflow-hidden rounded-md border border-input shadow-xs',
        'bg-gradient-to-b from-muted/70 via-muted/40 to-muted/70 text-foreground',
        'transition-[border-color,box-shadow,background-color] duration-150',
        isEditing ? 'cursor-text' : 'cursor-ew-resize select-none',
        isDragging ? 'border-ring ring-2 ring-ring/30' : 'hover:border-border/80',
        compact ? 'h-6 text-xs' : 'h-7 text-sm',
        disabled && 'opacity-50 pointer-events-none',
        className
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      role="spinbutton"
      aria-valuemin={hasMin ? (min as number) : undefined}
      aria-valuemax={hasMax ? (max as number) : undefined}
      aria-valuenow={Number.isFinite(value) ? value : undefined}
      tabIndex={-1}
    >
      {!isEditing && hasRange ? (
        <div
          className="absolute inset-0 rounded-md bg-primary/35"
          style={{ right: `${100 - fillPercent}%` }}
        />
      ) : null}

      <div className={cn('relative z-10 flex h-full items-center px-2', compact ? 'px-2' : 'px-3')}>
        {isEditing ? (
          <input
            ref={inputRef}
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitDraft();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                exitEditMode();
              }
            }}
            onBlur={() => {
              setDraftValue(displayValue);
              exitEditMode();
            }}
            className={cn(
              'h-full w-full bg-transparent text-right outline-none',
              'placeholder:text-muted-foreground'
            )}
            inputMode="decimal"
          />
        ) : (
          <span className="ml-auto tabular-nums">{displayValue}</span>
        )}
      </div>
    </div>
  );
}
