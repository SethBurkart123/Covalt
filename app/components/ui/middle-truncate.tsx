"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { cn } from "@/lib/utils";

type MeasureWidth = (value: string) => number;

interface TruncateOptions {
  ellipsis?: string;
  headRatio?: number;
  minHead?: number;
  minTail?: number;
}

interface MiddleTruncateProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  text: string;
  ellipsis?: string;
  headRatio?: number;
  minHead?: number;
  minTail?: number;
  title?: string;
}

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function getGraphemes(value: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => { segment: (input: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;

  if (!Segmenter) return Array.from(value);
  return Array.from(
    new Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    (part) => part.segment,
  );
}

function parseLetterSpacing(value: string): number {
  if (!value || value === "normal") return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canvasFont(style: CSSStyleDeclaration): string {
  if (style.font) return style.font;
  return [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontSize,
    style.fontFamily,
  ]
    .filter(Boolean)
    .join(" ");
}

function approximateWidth(value: string, fontSize: string, letterSpacing: number): number {
  const size = Number.parseFloat(fontSize);
  const averageGlyph = (Number.isFinite(size) ? size : 14) * 0.62;
  return getGraphemes(value).length * (averageGlyph + letterSpacing);
}

function makeCandidate(
  graphemes: string[],
  keepCount: number,
  ellipsis: string,
  headRatio: number,
  minHead: number,
  minTail: number,
): string {
  if (keepCount <= 0) return ellipsis;
  if (keepCount === 1) return `${graphemes[0] ?? ""}${ellipsis}`;

  const tailFloor = Math.min(minTail, keepCount - 1);
  const headFloor = Math.min(minHead, keepCount - tailFloor);
  const targetHead = Math.round(keepCount * headRatio);
  const headCount = Math.min(
    keepCount - tailFloor,
    Math.max(headFloor, targetHead),
  );
  const tailCount = keepCount - headCount;

  return `${graphemes.slice(0, headCount).join("")}${ellipsis}${graphemes
    .slice(graphemes.length - tailCount)
    .join("")}`;
}

export function truncateMiddleToWidth(
  text: string,
  width: number,
  measureWidth: MeasureWidth,
  {
    ellipsis = "...",
    headRatio = 0.45,
    minHead = 1,
    minTail = 1,
  }: TruncateOptions = {},
): string {
  if (!text || width <= 0) return text;
  if (measureWidth(text) <= width) return text;
  if (measureWidth(ellipsis) > width) return "";

  const graphemes = getGraphemes(text);
  let low = 0;
  let high = Math.max(0, graphemes.length - 1);
  let best = ellipsis;

  while (low <= high) {
    const keepCount = Math.floor((low + high) / 2);
    const candidate = makeCandidate(
      graphemes,
      keepCount,
      ellipsis,
      headRatio,
      minHead,
      minTail,
    );

    if (measureWidth(candidate) <= width) {
      best = candidate;
      low = keepCount + 1;
    } else {
      high = keepCount - 1;
    }
  }

  return best;
}

export function MiddleTruncate({
  text,
  ellipsis = "...",
  headRatio = 0.45,
  minHead = 1,
  minTail = 1,
  className,
  title,
  ...props
}: MiddleTruncateProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const measureCacheRef = useRef(new Map<string, number>());
  const normalizedText = text.replace(/[\r\n]+/g, " ");
  const [displayText, setDisplayText] = useState(normalizedText);

  useIsoLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      setDisplayText(normalizedText);
      return;
    }

    let frame = 0;
    let latestWidth = element.getBoundingClientRect().width;
    let disposed = false;
    const measureCache = measureCacheRef.current;
    measureCache.clear();

    const recalculate = () => {
      frame = 0;
      if (disposed) return;

      const style = getComputedStyle(element);
      const font = canvasFont(style);
      const letterSpacing = parseLetterSpacing(style.letterSpacing);
      const measureWidth = (value: string) => {
        const key = `${font}\n${letterSpacing}\n${value}`;
        const cached = measureCache.get(key);
        if (cached !== undefined) return cached;

        let measured: number;
        try {
          const prepared = prepareWithSegments(value, font, {
            whiteSpace: "pre-wrap",
            letterSpacing,
          });
          measured = measureNaturalWidth(prepared);
        } catch {
          measured = approximateWidth(value, style.fontSize, letterSpacing);
        }
        if (measureCache.size > 128) measureCache.clear();
        measureCache.set(key, measured);
        return measured;
      };

      const next = truncateMiddleToWidth(normalizedText, latestWidth, measureWidth, {
        ellipsis,
        headRatio,
        minHead,
        minTail,
      });
      setDisplayText((current) => (current === next ? current : next));
    };

    const schedule = () => {
      if (disposed) return;
      if (frame) return;
      frame = window.requestAnimationFrame(recalculate);
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      latestWidth = entry?.contentRect.width ?? element.getBoundingClientRect().width;
      schedule();
    });

    observer.observe(element);
    schedule();
    void document.fonts?.ready.then(schedule);

    return () => {
      disposed = true;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ellipsis, headRatio, minHead, minTail, normalizedText]);

  return (
    <span
      ref={ref}
      className={cn(
        "block min-w-0 max-w-full overflow-hidden whitespace-pre",
        className,
      )}
      title={title ?? text}
      aria-label={text}
      {...props}
    >
      {displayText}
    </span>
  );
}
