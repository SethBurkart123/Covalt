import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import net from 'net';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

function getStaticPath() {
  return path.join(__dirname, '..', 'out');
}

let mainWindow = null;
let backendProcess = null;
let backendPort = null;

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function getBackendPath() {
  if (isDev) return null;

  const binaryName = process.platform === 'win32' ? 'backend.exe' : 'backend';
  return path.join(process.resourcesPath, 'backend', binaryName);
}

async function startBackend(port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out after 30 seconds')), 30000);

    const spawnOptions = {
      cwd: isDev ? path.join(__dirname, '..') : undefined,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    let spawnArgs;
    if (isDev) {
      spawnArgs = ['uv', ['run', 'main.py', '--port', String(port), '--dev']];
    } else {
      const backendPath = getBackendPath();
      if (!fs.existsSync(backendPath)) {
        clearTimeout(timeout);
        reject(new Error(`Backend binary not found at: ${backendPath}`));
        return;
      }
      spawnArgs = [backendPath, ['--port', String(port), '--no-generate-ts']];
    }

    console.log(`[Electron] Starting backend on port ${port}...`);
    console.log(`[Electron] Command: ${spawnArgs[0]} ${spawnArgs[1].join(' ')}`);

    backendProcess = spawn(spawnArgs[0], spawnArgs[1], spawnOptions);

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Backend] ${output}`);
    });

    backendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`[Backend] ${output}`);
      
      if (output.includes(`BACKEND_READY:${port}`)) {
        clearTimeout(timeout);
        console.log(`[Electron] Backend is ready on port ${port}`);
        resolve(port);
      }
    });

    backendProcess.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[Electron] Failed to start backend:`, err);
      reject(err);
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Backend exited with code ${code}, signal ${signal}`);
      backendProcess = null;
      clearTimeout(timeout);
    });
  });
}

function stopBackend() {
  if (!backendProcess) return;

  console.log('[Electron] Stopping backend...');
  
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
  } else {
    backendProcess.kill('SIGTERM');
  }
  
  setTimeout(() => {
    if (backendProcess) {
      console.log('[Electron] Force killing backend...');
      backendProcess.kill('SIGKILL');
      backendProcess = null;
    }
  }, 5000);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: !isMac ? {
      color: '#3D3640',
      symbolColor: '#F5F3F1',
      height: 40,
    } : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    backgroundColor: '#3D3640',
    
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(getStaticPath(), 'index.html');
    mainWindow.loadURL(`file://${indexPath}`);
    console.log('[Electron] Loading from:', indexPath);
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => mainWindow = null);
}

ipcMain.handle('get-backend-port', () => backendPort);
ipcMain.handle('is-dev', () => isDev);

function setupProtocolInterceptor() {
  protocol.interceptFileProtocol('file', (request, callback) => {
    const url = request.url;
    
    if (url.includes('/_next/')) {
      const nextPath = url.substring(url.indexOf('/_next'));
      const filePath = path.join(getStaticPath(), nextPath);
      console.log('[Protocol] Intercepted:', url, '->', filePath);
      callback({ path: filePath });
      return;
    }
    
    callback({ path: fileURLToPath(url) });
  });
}

async function startup() {
  try {
    if (!isDev) setupProtocolInterceptor();

    backendPort = await findFreePort();
    console.log(`[Electron] Found free port: ${backendPort}`);

    await startBackend(backendPort);
    createWindow();
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    app.quit();
  }
}

app.whenReady().then(startup);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopBackend);
app.on('will-quit', stopBackend);

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
  stopBackend();
});
