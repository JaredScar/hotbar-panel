const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hotbar', {
  getBootstrap: () => ipcRenderer.invoke('bootstrap'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('update:progress', wrapped);
    return () => ipcRenderer.removeListener('update:progress', wrapped);
  },
});
