/**
 * Bridge initialization module
 * 
 * Handles initializing the zynk bridge with the correct backend port.
 * Works for both Electron (dynamic port) and web (default port 8000) modes.
 */
import { initBridge } from "@/python/api";

// Type declaration for the Electron API exposed via preload
declare global {
  interface Window {
    electron?: {
      platform: string;
      getBackendPort: () => Promise<number>;
      isDev: () => Promise<boolean>;
    };
  }
}

// Default port for web mode
const DEFAULT_PORT = 8000;

// Track initialization state
let bridgeInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the bridge with the correct backend URL.
 * In Electron, gets the port dynamically from the main process.
 * In web mode, uses the default port 8000.
 */
async function initializeBackend(): Promise<void> {
  let port = DEFAULT_PORT;
  
  // If running in Electron, get the dynamically assigned port
  if (typeof window !== 'undefined' && window.electron?.getBackendPort) {
    try {
      port = await window.electron.getBackendPort();
      console.log(`[Bridge] Using Electron backend port: ${port}`);
    } catch (err) {
      console.warn('[Bridge] Failed to get backend port from Electron, using default:', err);
    }
  } else {
    console.log(`[Bridge] Using default backend port: ${port}`);
  }
  
  initBridge(`http://127.0.0.1:${port}`);
}

/**
 * Ensure the bridge is initialized. Safe to call multiple times.
 * Returns a promise that resolves when the bridge is ready.
 */
export function ensureBridgeInitialized(): Promise<void> {
  if (bridgeInitialized) return Promise.resolve();
  if (!initPromise) {
    initPromise = initializeBackend().then(() => {
      bridgeInitialized = true;
    });
  }
  return initPromise;
}

/**
 * Check if the bridge has been initialized.
 */
export function isBridgeInitialized(): boolean {
  return bridgeInitialized;
}

// Auto-initialize when module loads in browser
if (typeof window !== 'undefined') {
  ensureBridgeInitialized();
}
