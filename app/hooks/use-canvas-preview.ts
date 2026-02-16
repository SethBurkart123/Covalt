'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toPng } from 'html-to-image';
import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react';
import { agentFileUrl, uploadAgentPreview } from '@/python/api';

const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;
const PREVIEW_PADDING = 0.06;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
const OFFSCREEN_OFFSET_PX = -10000;
const HIDDEN_SELECTORS = '.react-flow__controls, .react-flow__minimap, .react-flow__panel';
const PREVIEW_MAX_AGE_MS = 60 * 60 * 1000;
const IMAGE_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/J5cAAAAASUVORK5CYII=';

interface CanvasPreviewOptions {
  agentId: string;
  lastSaved: Date | null;
  previewImage?: string | null;
}

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

export function useCanvasPreview({ agentId, lastSaved, previewImage }: CanvasPreviewOptions) {
  const { getNodes } = useReactFlow();
  const isCapturingRef = useRef(false);
  const pendingCaptureRef = useRef(false);
  const previewTimestampRef = useRef<number | null>(null);

  const getPreviewTimestamp = useCallback(async (): Promise<number | null> => {
    if (previewTimestampRef.current) return previewTimestampRef.current;
    if (!previewImage) return null;

    const baseUrl = agentFileUrl({ agentId, fileType: 'preview' });
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;

    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) return null;
      const header = response.headers.get('last-modified');
      if (!header) return null;
      const timestamp = Date.parse(header);
      if (!Number.isNaN(timestamp)) {
        previewTimestampRef.current = timestamp;
        return timestamp;
      }
    } catch (err) {
      console.error('Failed to check preview timestamp:', err);
    }
    return null;
  }, [agentId, previewImage]);

  const shouldCapture = useCallback(async () => {
    if (!previewImage) return true;

    const previewTimestamp = await getPreviewTimestamp();
    if (!previewTimestamp) return true;

    if (lastSaved && previewTimestamp < lastSaved.getTime()) {
      return true;
    }

    if (Date.now() - previewTimestamp > PREVIEW_MAX_AGE_MS) {
      return true;
    }

    return false;
  }, [getPreviewTimestamp, lastSaved, previewImage]);

  const captureAndUpload = useCallback(async () => {
    if (isCapturingRef.current) {
      pendingCaptureRef.current = true;
      return;
    }
    isCapturingRef.current = true;
    pendingCaptureRef.current = false;

    const flowElement = document.querySelector('.react-flow') as HTMLElement | null;
    if (!flowElement) {
      isCapturingRef.current = false;
      return;
    }

    const nodes = getNodes();
    if (!nodes.length) {
      isCapturingRef.current = false;
      return;
    }

    const needsCapture = await shouldCapture();
    if (!needsCapture) {
      isCapturingRef.current = false;
      if (pendingCaptureRef.current) {
        pendingCaptureRef.current = false;
        void captureAndUpload();
      }
      return;
    }

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
        imagePlaceholder: IMAGE_PLACEHOLDER,
        onImageErrorHandler: () => true,
      });

      if (!dataUrl) return;

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'preview.png', { type: 'image/png' });
      await uploadAgentPreview({ file, agentId }).promise;
      previewTimestampRef.current = Date.now();
    } catch (err) {
      console.error('Failed to capture/upload preview:', err);
    } finally {
      snapshotRoot.remove();
      isCapturingRef.current = false;
      if (pendingCaptureRef.current) {
        pendingCaptureRef.current = false;
        void captureAndUpload();
      }
    }
  }, [agentId, getNodes, shouldCapture]);

  useEffect(() => {
    previewTimestampRef.current = null;
  }, [agentId, previewImage]);

  return { captureAndUpload };
}
