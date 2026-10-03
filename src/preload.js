'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('galaxyBridge', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  showMenu: () => ipcRenderer.send('show-menu'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  cycleVisual: () => ipcRenderer.send('cycle-visual'),
  onSetVisual: (cb) => ipcRenderer.on('set-visual', (_e, visual) => cb(visual)),
  onSetDelay: (cb) => ipcRenderer.on('set-delay', (_e, ms) => cb(ms)),
  onSetSource: (cb) => ipcRenderer.on('set-source', (_e, source) => cb(source)),
});
