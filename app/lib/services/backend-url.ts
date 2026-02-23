import { initBridge } from "@/python/_internal";

const STORAGE_KEY = "covalt:backendBaseUrl";
let cachedBaseUrl: string | null = null;
const listeners = new Set<(value: string) => void>();

type BackendWindow = Window & {
  __COVALT_BACKEND_BASE_URL?: string;
  __COVALT_SET_BACKEND_BASE_URL?: (value: string) => void;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function getBackendBaseUrl(): string {
  if (typeof window !== "undefined") {
    const backendWindow = window as BackendWindow;
    const globalUrl = backendWindow.__COVALT_BACKEND_BASE_URL;

    if (typeof globalUrl === "string" && globalUrl.trim()) {
      cachedBaseUrl = normalizeBaseUrl(globalUrl);
      return cachedBaseUrl;
    }

    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get("backend");

    if (paramUrl) {
      cachedBaseUrl = normalizeBaseUrl(decodeURIComponent(paramUrl));
      backendWindow.__COVALT_BACKEND_BASE_URL = cachedBaseUrl;
      try {
        window.localStorage.setItem(STORAGE_KEY, cachedBaseUrl);
      } catch {}
      return cachedBaseUrl;
    }

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        cachedBaseUrl = normalizeBaseUrl(stored);
        backendWindow.__COVALT_BACKEND_BASE_URL = cachedBaseUrl;
        return cachedBaseUrl;
      }
    } catch {}
  }

  if (cachedBaseUrl) return cachedBaseUrl;

  const envUrl = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL;
  if (envUrl) {
    cachedBaseUrl = normalizeBaseUrl(envUrl);
    return cachedBaseUrl;
  }

  cachedBaseUrl = "http://127.0.0.1:8000";
  return cachedBaseUrl;
}

export function setBackendBaseUrl(value: string): void {
  cachedBaseUrl = normalizeBaseUrl(value);

  if (typeof window === "undefined") return;

  const backendWindow = window as BackendWindow;
  backendWindow.__COVALT_BACKEND_BASE_URL = cachedBaseUrl;

  try {
    window.localStorage.setItem(STORAGE_KEY, cachedBaseUrl);
  } catch {}

  initBridge(cachedBaseUrl);
  for (const listener of listeners) {
    try {
      listener(cachedBaseUrl);
    } catch (error) {
      console.error("Backend base URL listener failed:", error);
    }
  }
}

export function subscribeBackendBaseUrl(listener: (value: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  const backendWindow = window as BackendWindow;
  backendWindow.__COVALT_SET_BACKEND_BASE_URL = (value: string) => {
    setBackendBaseUrl(value);
  };
}
