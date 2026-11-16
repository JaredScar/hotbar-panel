const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hotbar', {
  getBootstrap: () => ipcRenderer.invoke('bootstrap'),
});
