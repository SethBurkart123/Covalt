import Electrobun, { BrowserWindow, Utils, PATHS } from "electrobun/bun";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { connect, createServer } from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const DEV_FRONTEND_URL = "http://localhost:3000";
const DEV_PORT_SCAN = Array.from({ length: 11 }, (_, index) => 3000 + index);
const DEV_SERVER_TIMEOUT_MS = 15000;
const DEV_SERVER_RETRY_MS = 300;
const READY_TIMEOUT_MS = Number.parseInt(
  process.env.ELECTROBUN_BACKEND_READY_TIMEOUT_MS ?? "120000",
  10,
);
const RETRY_DELAY_MS = 500;

function isDevMode(): boolean {
  return process.env.ELECTROBUN_DEV === "1";
}

function getProjectRoot(): string {
  const envRoot = process.env.ELECTROBUN_PROJECT_ROOT;
  if (envRoot && envRoot.trim()) {
    return path.resolve(envRoot);
  }
  const initCwd = process.env.INIT_CWD;
  if (initCwd && initCwd.trim()) {
    return path.resolve(initCwd);
  }
  const pwd = process.env.PWD;
  if (pwd && pwd.trim()) {
    return path.resolve(pwd);
  }
  return process.cwd();
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return null;
  return parsed;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Failed to resolve an available port."));
      }
    });
  });
}

async function resolveBackendPort(): Promise<number> {
  const envPort = parsePort(process.env.AGNO_BACKEND_PORT);
  if (envPort) return envPort;
  return getAvailablePort();
}

function getBackendBinaryPath(): string {
  const binaryName = process.platform === "win32" ? "agno-backend.exe" : "agno-backend";
  const candidates = [
    path.resolve(PATHS.VIEWS_FOLDER, "..", "backend", binaryName),
    path.resolve(PATHS.VIEWS_FOLDER, "..", "..", "backend", binaryName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function startBackendProcess(options: {
  port: number;
  devMode: boolean;
}): ChildProcessWithoutNullStreams {
  const { port, devMode } = options;
  const env = {
    ...process.env,
    AGNO_BACKEND_PORT: String(port),
    AGNO_DEV_MODE: devMode ? "1" : "0",
    AGNO_GENERATE_TS: devMode ? "1" : "0",
  };

  if (devMode) {
    const command = process.env.AGNO_BACKEND_COMMAND || "uv";
    const args = process.env.AGNO_BACKEND_ARGS?.split(" ").filter(Boolean) ?? ["run", "main.py"];
    const cwd = getProjectRoot();

    const processHandle = spawn(command, args, {
      cwd,
      env,
      stdio: "pipe",
    });

    wireBackendLogs(processHandle);
    return processHandle;
  }

  const processHandle = spawn(getBackendBinaryPath(), [], {
    env,
    stdio: "pipe",
  });

  wireBackendLogs(processHandle);
  return processHandle;
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

async function resolveDevFrontendUrl(): Promise<string> {
  const envUrl = process.env.ELECTROBUN_DEV_URL;
  const start = Date.now();

  while (Date.now() - start < DEV_SERVER_TIMEOUT_MS) {
    if (envUrl && (await checkUrl(envUrl))) return envUrl;

    if (await checkUrl(DEV_FRONTEND_URL)) return DEV_FRONTEND_URL;

    for (const port of DEV_PORT_SCAN) {
      const candidate = `http://localhost:${port}`;
      if (await checkUrl(candidate)) return candidate;
    }

    await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_RETRY_MS));
  }

  return envUrl ?? DEV_FRONTEND_URL;
}

function buildAppUrl(devFrontendUrl?: string): string {
  const raw = devFrontendUrl ?? `views://mainview/index.html`;
  return new URL(raw).toString();
}

type BrowserWindowInstance = InstanceType<typeof BrowserWindow>;

type FrontendServer = ReturnType<typeof Bun.serve>;

function getContentType(filePath: string): string {
  if (filePath.endsWith(".txt")) return "text/x-component";
  const mimeType = Bun.file(filePath).type ?? "application/octet-stream";
  return mimeType.split(";")[0] || "application/octet-stream";
}

function resolveStaticFile(rootDir: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const stripped = decoded.replace(/^\/+/, "");
  const normalized = path.normalize(stripped);
  const candidate = path.resolve(rootDir, normalized);
  if (candidate !== rootDir && !candidate.startsWith(`${rootDir}${path.sep}`)) {
    return null;
  }

  const tryFile = (filePath: string): string | null => {
    if (!existsSync(filePath)) return null;
    try {
      const stat = statSync(filePath);
      if (stat.isFile()) return filePath;
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, "index.html");
        if (existsSync(indexPath)) return indexPath;
      }
    } catch {
      return null;
    }
    return null;
  };

  if (decoded === "/" || decoded === "") {
    return tryFile(path.join(rootDir, "index.html"));
  }

  const direct = tryFile(candidate);
  if (direct) return direct;

  if (!path.extname(candidate)) {
    const htmlPath = `${candidate}.html`;
    const htmlFile = tryFile(htmlPath);
    if (htmlFile) return htmlFile;
  }

  return null;
}

function startFrontendServer(): { url: string; server: FrontendServer } {
  const rootDir = path.join(PATHS.VIEWS_FOLDER, "mainview");
  const server = Bun.serve({
    hostname: HOST,
    port: 0,
    fetch: async (req) => {
      const { pathname } = new URL(req.url);
      const filePath = resolveStaticFile(rootDir, pathname);
      if (!filePath) {
        const notFound = path.join(rootDir, "404.html");
        if (existsSync(notFound)) {
          return new Response(Bun.file(notFound).stream(), {
            status: 404,
            headers: { "Content-Type": "text/html" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      return new Response(Bun.file(filePath).stream(), {
        headers: { "Content-Type": getContentType(filePath) },
      });
    },
  });

  const url = `http://${HOST}:${server.port}`;
  console.log(`[frontend] Serving static UI from ${rootDir} at ${url}`);
  return { url, server };
}

function injectBackendBaseUrl(mainWindow: BrowserWindowInstance, baseUrl: string): void {
  const payload = JSON.stringify(baseUrl);
  const platform = process.platform;
  const isMac = platform === "darwin";
  const js = `
    try {
      document.documentElement?.classList?.add("electrobun");
      ${isMac ? 'document.documentElement?.classList?.add("electrobun-macos");' : ""}
      window.__AGNO_ELECTROBUN_PLATFORM = ${JSON.stringify(platform)};
      if (typeof window.__AGNO_SET_BACKEND_BASE_URL === "function") {
        window.__AGNO_SET_BACKEND_BASE_URL(${payload});
      } else {
        window.__AGNO_BACKEND_BASE_URL = ${payload};
        window.localStorage?.setItem("agno:backendBaseUrl", ${payload});
      }
    } catch {}
  `;
  mainWindow.webview.executeJavascript(js);
}

type NewWindowOpenEvent = {
  data?: {
    detail?: unknown;
  };
};

function extractNewWindowUrl(event: NewWindowOpenEvent, appUrl: string): string | null {
  const detail = event?.data?.detail;
  let rawUrl: string | null = null;
  if (typeof detail === "string") {
    rawUrl = detail;
  } else if (detail && typeof detail === "object" && "url" in detail) {
    const candidate = (detail as { url?: unknown }).url;
    rawUrl = typeof candidate === "string" ? candidate : null;
  }

  if (!rawUrl || rawUrl === "about:blank") return null;

  try {
    return new URL(rawUrl, appUrl).toString();
  } catch {
    return null;
  }
}

function shouldOpenExternally(url: string, appUrl: string): boolean {
  try {
    const resolved = new URL(url);
    if (resolved.protocol === "about:" || resolved.protocol === "views:") return false;
    if (resolved.protocol === "http:" || resolved.protocol === "https:") {
      const appOrigin = new URL(appUrl).origin;
      return resolved.origin !== appOrigin;
    }
    return true;
  } catch {
    return false;
  }
}

function wirePopupHandling(webviewId: number, appUrl: string): void {
  const handler = (event: NewWindowOpenEvent) => {
    const url = extractNewWindowUrl(event, appUrl);
    if (!url) return;

    if (!shouldOpenExternally(url, appUrl)) return;

    const opened = Utils.openExternal(url);
    if (!opened) {
      console.warn(`[webview] Failed to open external URL: ${url}`);
    }
  };

  Electrobun.events.on(`new-window-open-${webviewId}`, handler);
}

function wireBackendLogs(processHandle: ChildProcessWithoutNullStreams): void {
  processHandle.stdout.on("data", (chunk) => {
    console.log(`[backend] ${chunk.toString()}`.trim());
  });
  processHandle.stderr.on("data", (chunk) => {
    console.error(`[backend] ${chunk.toString()}`.trim());
  });
  processHandle.on("exit", (code) => {
    console.log(`[backend] exited with code ${code ?? "unknown"}`);
  });
}

async function canConnect(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

async function waitForBackend(
  baseUrl: string,
  processHandle: ChildProcessWithoutNullStreams,
): Promise<void> {
  const timeoutMs = Number.isFinite(READY_TIMEOUT_MS) && READY_TIMEOUT_MS > 0
    ? READY_TIMEOUT_MS
    : 120000;
  const deadline = Date.now() + timeoutMs;
  const readyTimeout = `${Math.round(timeoutMs / 1000)}s`;
  const { hostname, port } = new URL(baseUrl);
  const backendPort = Number.parseInt(port, 10);
  if (!Number.isFinite(backendPort)) {
    throw new Error(`Invalid backend URL: ${baseUrl}`);
  }
  console.log(`[backend] Waiting up to ${readyTimeout} for ${baseUrl}...`);

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error("Backend process exited before becoming ready.");
    }

    if (await canConnect(hostname, backendPort)) return;

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  throw new Error(`Backend did not become ready at ${baseUrl}.`);
}

function stopBackend(processHandle: ChildProcessWithoutNullStreams | null): void {
  if (!processHandle || processHandle.killed) return;
  processHandle.kill();
}

async function main(): Promise<void> {
  const devMode = isDevMode();
  const port = await resolveBackendPort();
  const baseUrl = `http://${HOST}:${port}`;

  const backendProcess = startBackendProcess({ port, devMode });
  await waitForBackend(baseUrl, backendProcess);

  let frontendServer: FrontendServer | null = null;
  let appUrl: string;
  if (devMode) {
    const devFrontendUrl = await resolveDevFrontendUrl();
    appUrl = buildAppUrl(devFrontendUrl);
  } else {
    const frontend = startFrontendServer();
    frontendServer = frontend.server;
    appUrl = frontend.url;
  }

  const mainWindow = new BrowserWindow({
    title: "Agno",
    url: appUrl,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    frame: {
      width: 1200,
      height: 800,
      x: 120,
      y: 80,
    },
  });
  mainWindow.webview.on("dom-ready", () => {
    injectBackendBaseUrl(mainWindow, baseUrl);
  });
  wirePopupHandling(mainWindow.webview.id, appUrl);

  mainWindow.on("close", () => {
    stopBackend(backendProcess);
    frontendServer?.stop(true);
    Utils.quit();
  });
}

main().catch((error) => {
  console.error("Failed to launch Agno:", error);
  Utils.quit();
});
