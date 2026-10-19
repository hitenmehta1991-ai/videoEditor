'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('reeldesk', Object.freeze({
  dropMedia: files => ipcRenderer.invoke('drop-media', files.map(f => webUtils.getPathForFile(f))),
  chooseVideos: () => ipcRenderer.invoke('choose-videos'),
  chooseMusic: () => ipcRenderer.invoke('choose-music'),
  saveProject: p => ipcRenderer.invoke('save-project', p),
  openProject: () => ipcRenderer.invoke('open-project'),
  previewSequence: p => ipcRenderer.invoke('preview-sequence', p),
  exportVideo: p => ipcRenderer.invoke('export-video', p),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  revealExport: file => ipcRenderer.invoke('reveal-export', file),
  onExportProgress: callback => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on('export-progress', handler);
    return () => ipcRenderer.removeListener('export-progress', handler);
  }
}));
