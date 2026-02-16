'use client';

import { useChat } from '@/contexts/chat-context';
import ModelSelector from '@/components/ModelSelector';
import type { ControlProps } from './';

interface ModelPickerProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

export function ModelPicker({ value, onChange, compact }: ModelPickerProps) {
  const { models } = useChat();

  return (
    <ModelSelector
      selectedModel={value ?? ''}
      setSelectedModel={onChange}
      models={models}
      hideAgents
      className={compact
        ? 'h-7 text-xs px-2 w-full rounded-md'
        : 'h-8 text-sm px-2 w-full rounded-md'
      }
    />
  );
}
