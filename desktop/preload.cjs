const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld(
    'ljktDesktop',
    Object.freeze({
      info: () => ipcRenderer.invoke('ljkt:info'),
      openDataDirectory: () => ipcRenderer.invoke('ljkt:open-data-directory'),
      openDownloadedItem: (id) => ipcRenderer.invoke('ljkt:open-downloaded-item', id),
      listDownloads: () => ipcRenderer.invoke('ljkt:list-downloads'),
      onDownloadFinished: (callback) => {
        const listener = (_event, details) => callback(details);
        ipcRenderer.on('ljkt:download-finished', listener);
        return () => ipcRenderer.removeListener('ljkt:download-finished', listener);
      },
      onNewChat: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('ljkt:new-chat', listener);
        return () => ipcRenderer.removeListener('ljkt:new-chat', listener);
      },
    }),
  );
}
