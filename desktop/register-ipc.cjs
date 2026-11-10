'use strict';

function registerDesktopIpc({ ipcMain, app, shell, verifySender, downloads }) {
  ipcMain.handle('ljkt:info', (event) => {
    verifySender(event);
    return {
      version: app.getVersion(),
      dataDirectory: app.getPath('userData'),
      platform: process.platform,
    };
  });
  ipcMain.handle('ljkt:open-data-directory', (event) => {
    verifySender(event);
    return shell.openPath(app.getPath('userData'));
  });
  ipcMain.handle('ljkt:list-downloads', (event) => {
    verifySender(event);
    return downloads.list();
  });
  ipcMain.handle('ljkt:open-downloaded-item', (event, id) => {
    verifySender(event);
    return downloads.reveal(id);
  });
}

module.exports = { registerDesktopIpc };
