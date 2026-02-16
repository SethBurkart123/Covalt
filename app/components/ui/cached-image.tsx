"use client";

import { useState, useEffect } from "react";

const cache = new Map<string, string>();
const errors = new Set<string>();
const loading = new Map<string, Promise<string>>();

function load(src: string): Promise<string> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!);
  if (errors.has(src)) return Promise.resolve("");

  if (!loading.has(src)) {
    const promise = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        cache.set(src, url);
        return url;
      })
      .catch(() => {
        errors.add(src);
        return "";
      })
      .finally(() => loading.delete(src));

    loading.set(src, promise);
  }

  return loading.get(src)!;
}

interface CachedImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export function CachedImage({ src, alt = "", className }: CachedImageProps) {
  const [url, setUrl] = useState<string | null>(cache.get(src) ?? null);

  useEffect(() => {
    if (cache.has(src)) { setUrl(cache.get(src)!); return; }
    if (errors.has(src)) return;

    let cancelled = false;
    load(src).then((result) => {
      if (!cancelled && result) setUrl(result);
    });
    return () => { cancelled = true; };
  }, [src]);

  if (!url) return null;
  return <img src={url} alt={alt} className={className} />;
}

export function preloadImages(urls: string[]) {
  for (const url of urls) load(url);
}
