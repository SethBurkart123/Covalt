const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, secure API to the renderer process
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  
  // Get the dynamically assigned backend port
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  
  // Check if running in development mode
  isDev: () => ipcRenderer.invoke('is-dev'),
});
