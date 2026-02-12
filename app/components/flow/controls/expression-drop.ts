'use client';

import type React from 'react';

type DropTarget = HTMLInputElement | HTMLTextAreaElement;

function getDroppedText(event: React.DragEvent<DropTarget>): string {
  const text = event.dataTransfer.getData('text/plain');
  return text.trim();
}

export function shouldHandleExpressionDrop(event: React.DragEvent<DropTarget>): boolean {
  const text = getDroppedText(event);
  return text.length > 0;
}

export function applyExpressionDrop(
  event: React.DragEvent<DropTarget>,
  currentValue: string,
  onChange: (next: string) => void
): void {
  const expression = getDroppedText(event);
  if (!expression) return;

  event.preventDefault();

  const target = event.currentTarget;
  const start = target.selectionStart ?? currentValue.length;
  const end = target.selectionEnd ?? currentValue.length;
  const nextValue = `${currentValue.slice(0, start)}${expression}${currentValue.slice(end)}`;

  onChange(nextValue);

  requestAnimationFrame(() => {
    target.focus();
    const caretPosition = start + expression.length;
    target.setSelectionRange(caretPosition, caretPosition);
  });
}
