'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reeldesk', Object.freeze({
  chooseVideos: () => ipcRenderer.invoke('choose-videos'),
  chooseMusic: () => ipcRenderer.invoke('choose-music'),
  saveProject: p => ipcRenderer.invoke('save-project', p),
  openProject: () => ipcRenderer.invoke('open-project'),
  exportVideo: p => ipcRenderer.invoke('export-video', p),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  revealExport: file => ipcRenderer.invoke('reveal-export', file),
  onExportProgress: callback => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on('export-progress', handler);
    return () => ipcRenderer.removeListener('export-progress', handler);
  }
}));
