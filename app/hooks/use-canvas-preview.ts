'use client';

import { useCallback, useRef } from 'react';
import { toPng } from 'html-to-image';
import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react';
import { uploadAgentPreview } from '@/python/api';

const CAPTURE_DEBOUNCE_MS = 5 * 60 * 1000;
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;
const PREVIEW_PADDING = 0.06;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
const OFFSCREEN_OFFSET_PX = -10000;
const HIDDEN_SELECTORS = '.react-flow__controls, .react-flow__minimap, .react-flow__panel';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createSnapshotRoot(): HTMLDivElement {
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.position = 'fixed';
  root.style.left = `${OFFSCREEN_OFFSET_PX}px`;
  root.style.top = '0';
  root.style.width = `${PREVIEW_WIDTH}px`;
  root.style.height = `${PREVIEW_HEIGHT}px`;
  root.style.overflow = 'hidden';
  root.style.pointerEvents = 'none';
  root.style.opacity = '0';
  return root;
}

function prepareClone(
  flowElement: HTMLElement,
  viewport: { x: number; y: number; zoom: number }
): HTMLElement {
  const clone = flowElement.cloneNode(true) as HTMLElement;
  clone.style.width = `${PREVIEW_WIDTH}px`;
  clone.style.height = `${PREVIEW_HEIGHT}px`;
  clone.style.maxWidth = 'none';
  clone.style.maxHeight = 'none';

  const viewportElement = clone.querySelector<HTMLElement>('.react-flow__viewport');
  if (viewportElement) {
    viewportElement.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  }

  clone.querySelectorAll(HIDDEN_SELECTORS).forEach((element) => {
    (element as HTMLElement).style.display = 'none';
  });

  return clone;
}

export function useCanvasPreview(agentId: string) {
  const { getNodes } = useReactFlow();
  const lastCaptureRef = useRef<number>(0);
  const isCapturingRef = useRef(false);

  const captureAndUpload = useCallback(async () => {
    const now = Date.now();
    if (now - lastCaptureRef.current < CAPTURE_DEBOUNCE_MS) return;
    if (isCapturingRef.current) return;

    const flowElement = document.querySelector('.react-flow') as HTMLElement | null;
    if (!flowElement) return;

    const nodes = getNodes();
    if (!nodes.length) return;

    isCapturingRef.current = true;
    lastCaptureRef.current = now;

    const bounds = getNodesBounds(nodes);
    const viewport = getViewportForBounds(
      bounds,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
      MIN_ZOOM,
      MAX_ZOOM,
      PREVIEW_PADDING
    );

    const snapshotRoot = createSnapshotRoot();
    const clone = prepareClone(flowElement, viewport);

    snapshotRoot.appendChild(clone);
    document.body.appendChild(snapshotRoot);

    try {
      await nextFrame();
      await nextFrame();

      const dataUrl = await toPng(clone, {
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        canvasWidth: PREVIEW_WIDTH,
        canvasHeight: PREVIEW_HEIGHT,
        pixelRatio: 1,
        skipAutoScale: true,
        cacheBust: true,
      });

      if (!dataUrl) return;

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'preview.png', { type: 'image/png' });
      await uploadAgentPreview({ file, agentId }).promise;
    } catch (err) {
      console.error('Failed to capture/upload preview:', err);
    } finally {
      snapshotRoot.remove();
      isCapturingRef.current = false;
    }
  }, [agentId, getNodes]);

  return { captureAndUpload };
}
