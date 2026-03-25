const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usurper', {
  getConfig: () => ipcRenderer.invoke('get-config')
});
