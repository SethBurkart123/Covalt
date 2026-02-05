'use client';

import { useCallback, useRef } from 'react';
import { toPng } from 'html-to-image';
import { uploadAgentPreview } from '@/python/api';

const CAPTURE_DEBOUNCE_MS = 1000;

export function useCanvasPreview(agentId: string) {
  const lastCaptureRef = useRef<number>(0);
  const isCapturingRef = useRef(false);

  const captureAndUpload = useCallback(async () => {
    const now = Date.now();
    if (now - lastCaptureRef.current < CAPTURE_DEBOUNCE_MS) return;
    if (isCapturingRef.current) return;

    const element = document.querySelector('.react-flow') as HTMLElement | null;
    if (!element) return;

    isCapturingRef.current = true;
    lastCaptureRef.current = now;

    try {
      const dataUrl = await toPng(element, {
        pixelRatio: 0.5,
        skipAutoScale: true,
        filter: (node) => {
          // Exclude UI controls and background from the screenshot
          if (node instanceof HTMLElement) {
            const className = node.className || '';
            if (typeof className === 'string') {
              if (className.includes('react-flow__controls')) return false;
              if (className.includes('react-flow__minimap')) return false;
              if (className.includes('react-flow__background')) return false;
            }
          }
          return true;
        },
      });

      if (!dataUrl) {
        console.warn('Failed to capture canvas: no data URL generated');
        return;
      }

      // Convert data URL to blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'preview.png', { type: 'image/png' });
      await uploadAgentPreview({ file, agentId }).promise;
    } catch (err) {
      console.error('Failed to capture/upload preview:', err);
    } finally {
      isCapturingRef.current = false;
    }
  }, [agentId]);

  return { captureAndUpload };
}
