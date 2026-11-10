'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createDownloadManager({ app, session, shell, getWindow, log = () => {} }) {
  const historyPath = () => path.join(app.getPath('userData'), 'download-history.json');
  const completedDownloads = new Map();
  let history = [];
  let persistQueue = Promise.resolve();

  function load() {
    try {
      const items = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
      history = Array.isArray(items)
        ? items
            .filter(
              (item) =>
                item &&
                typeof item.id === 'string' &&
                typeof item.filePath === 'string' &&
                fs.existsSync(item.filePath),
            )
            .slice(0, 100)
        : [];
      for (const item of history) completedDownloads.set(item.id, item.filePath);
    } catch {
      history = [];
    }
  }

  function persist() {
    const snapshot = JSON.stringify(history, null, 2);
    const operation = persistQueue.catch(() => {}).then(async () => {
      const target = historyPath();
      const temporary = `${target}.tmp`;
      await fs.promises.writeFile(temporary, snapshot, { mode: 0o600 });
      await fs.promises.rename(temporary, target);
    });
    persistQueue = operation;
    return operation;
  }

  function install() {
    session.defaultSession.on('will-download', (_event, item) => {
      const sourceUrl = item.getURL();
      item.setSaveDialogOptions({
        title: '保存灵境课堂成果',
        defaultPath: path.join(app.getPath('documents'), path.basename(item.getFilename())),
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      item.once('done', async (_event, state) => {
        const details = { sourceUrl, completed: state === 'completed' };
        if (state === 'completed') {
          const savedPath = item.getSavePath();
          if (savedPath) {
            const record = {
              id: randomUUID(),
              filename: path.basename(savedPath),
              filePath: savedPath,
              completedAt: Date.now(),
            };
            completedDownloads.set(record.id, savedPath);
            history = [record, ...history.filter((entry) => entry.id !== record.id)].slice(0, 100);
            try {
              await persist();
              Object.assign(details, { id: record.id, filename: record.filename });
            } catch (error) {
              log(`Failed to persist download history: ${error.message}\n`);
              details.completed = false;
            }
          } else {
            details.completed = false;
          }
        }
        const window = getWindow();
        if (window && !window.isDestroyed()) window.webContents.send('ljkt:download-finished', details);
      });
    });
  }

  function list() {
    history = history.filter((item) => {
      const exists = fs.existsSync(item.filePath);
      if (!exists) completedDownloads.delete(item.id);
      return exists;
    });
    return history.map(({ id, filename, completedAt }) => ({ id, filename, completedAt }));
  }

  function reveal(id) {
    if (typeof id !== 'string') throw new Error('Invalid download reference');
    const savedPath = completedDownloads.get(id);
    if (!savedPath || !fs.existsSync(savedPath)) {
      completedDownloads.delete(id);
      throw new Error('Downloaded file is no longer available');
    }
    shell.showItemInFolder(savedPath);
    return true;
  }

  return { load, install, list, reveal };
}

module.exports = { createDownloadManager };
