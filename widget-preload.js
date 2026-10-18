const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  onTrack(callback) {
    ipcRenderer.on('show-widget', (_event, track) => callback(track));
  },
  onHide(callback) {
    ipcRenderer.on('hide-widget', callback);
  },
  onPosition(callback) {
    ipcRenderer.on('widget-position', (_event, position) => callback(position));
  },
  onMiniPlayerTrack(callback) {
    ipcRenderer.on('mini-player-track', (_event, track) => callback(track));
  },
  control(action) {
    ipcRenderer.send('mini-player-control', action);
  }
});
