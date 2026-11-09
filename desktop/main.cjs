const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  session,
  shell,
  utilityProcess,
  nativeImage,
} = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

app.setName('灵境课堂 Bot');
app.setPath('userData', path.join(app.getPath('appData'), 'LingjingClassroomBot'));
const isDev = !app.isPackaged && process.argv.includes('--dev');
const port = Number(process.env.LJKT_BOT_DESKTOP_PORT || '30310');
const origin = `http://127.0.0.1:${port}`;
let service;
let window;
let quitting = false;
let log;
let serviceFailed;
const instance = randomUUID();
const completedDownloads = new Map();
let downloadsHistory = [];
const downloadsHistoryPath = () => path.join(app.getPath('userData'), 'download-history.json');
const loadDownloadsHistory = () => {
  try {
    const items = JSON.parse(fs.readFileSync(downloadsHistoryPath(), 'utf8'));
    downloadsHistory = Array.isArray(items)
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
    for (const item of downloadsHistory) completedDownloads.set(item.id, item.filePath);
  } catch {
    downloadsHistory = [];
  }
};
const persistDownloadsHistory = async () => {
  const temporaryPath = `${downloadsHistoryPath()}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(downloadsHistory, null, 2), {
    mode: 0o600,
  });
  await fs.promises.rename(temporaryPath, downloadsHistoryPath());
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(boot)
    .catch(async (error) => {
      await dialog.showMessageBox({
        type: 'error',
        title: '灵境课堂 Bot 启动失败',
        message: error.message,
        detail: '原灵境课堂不会被关闭或改动。详细记录保存在 Bot 独立数据目录的 logs 文件夹。',
      });
      app.quit();
    });
}

const trusted = (url) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};
const external = async (url) => {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol) && !trusted(url))
      await shell.openExternal(parsed.href);
  } catch {
    /* Ignore invalid URLs. */
  }
};
const verifySender = (event) => {
  if (
    !event.senderFrame ||
    !trusted(event.senderFrame.url) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('Untrusted desktop request');
};

async function checkPort() {
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 3002, 3010, 3012].includes(port)
  )
    throw new Error('桌面服务需要独立端口，默认30310。');
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Bot端口 ${port} 已占用，请关闭另一份Bot服务后重试。`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function waitReady() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (serviceFailed) throw serviceFailed;
    try {
      const response = await fetch(`${origin}/api/bot/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = await response.json();
      if (response.ok && body.application === 'ljkt-bot' && body.instance === instance) return;
    } catch {
      /* The owned child may still be starting or compiling. */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('本机Bot服务启动超时，请查看独立日志后重试。');
}

function withoutSymlinkPreservation(flags) {
  return flags.filter((flag) => !/^--preserve-symlinks(?:-main)?(?:=|$)/.test(flag));
}

function withoutSymlinkPreservationInNodeOptions(value = '') {
  return value
    .replace(/(^|\s)--preserve-symlinks(?:-main)?(?:=(?:true|false|0|1))?(?=\s|$)/g, '$1')
    .trim();
}

async function boot() {
  loadDownloadsHistory();
  await checkPort();
  const root = path.resolve(__dirname, '..');
  const appDir = app.isPackaged ? path.join(process.resourcesPath, 'server') : root;
  if (!isDev && !fs.existsSync(path.join(appDir, '.next', 'BUILD_ID')))
    throw new Error('尚未构建课件核心，请先运行 pnpm bot:desktop:build。');
  const dataDir = path.join(app.getPath('userData'), 'data');
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  log = fs.createWriteStream(path.join(logsDir, 'desktop.log'), { flags: 'a' });
  log.write(`\n[${new Date().toISOString()}] ${app.getVersion()} starting ${origin}\n`);
  service = utilityProcess.fork(path.join(__dirname, 'service.cjs'), [], {
    cwd: appDir,
    stdio: 'pipe',
    serviceName: 'Lingjing Bot Local Service',
    // Resolve pnpm virtual-store packages through real paths so peer
    // dependencies are discoverable by Node in the utility process.
    execArgv: [...withoutSymlinkPreservation(process.execArgv), '--no-preserve-symlinks'],
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      LJKT_BOT_APP_DIR: appDir,
      LJKT_BOT_INSTANCE_ID: instance,
      LJKT_BOT_DESKTOP_DEV: isDev ? '1' : '0',
      LJKT_BOT_DATA_DIR: dataDir,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: withoutSymlinkPreservationInNodeOptions(process.env.NODE_OPTIONS),
    },
  });
  service.stdout?.on('data', (chunk) => {
    log.write(chunk);
    if (!app.isPackaged) process.stdout.write(chunk);
  });
  service.stderr?.on('data', (chunk) => {
    log.write(chunk);
    if (!app.isPackaged) process.stderr.write(chunk);
  });
  service.once('exit', (code) => {
    if (!quitting) {
      serviceFailed = new Error(`Bot本机服务已退出（${code}），请重新打开应用。`);
      if (window) dialog.showErrorBox('本机服务已停止', serviceFailed.message);
    }
  });
  const iconPath = path.join(appDir, 'public', 'lingjing-mark.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && app.dock && !icon.isEmpty()) app.dock.setIcon(icon);
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 940,
    minHeight: 660,
    show: false,
    title: '灵境课堂 Bot',
    backgroundColor: '#faf9f6',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void external(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!trusted(url)) {
      event.preventDefault();
      void external(url);
    }
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      contents === window.webContents &&
        trusted(details.requestingUrl) &&
        ['media', 'fullscreen', 'clipboard-sanitized-write'].includes(permission),
    ),
  );
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
          const id = randomUUID();
          const record = {
            id,
            filename: path.basename(savedPath),
            filePath: savedPath,
            completedAt: Date.now(),
          };
          completedDownloads.set(id, savedPath);
          downloadsHistory = [record, ...downloadsHistory.filter((entry) => entry.id !== id)].slice(
            0,
            100,
          );
          try {
            await persistDownloadsHistory();
            Object.assign(details, { id, filename: record.filename });
          } catch (error) {
            log?.write(`Failed to persist download history: ${error.message}\n`);
            details.completed = false;
          }
        } else {
          details.completed = false;
        }
      }
      window?.webContents.send('ljkt:download-finished', details);
    });
  });
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
    downloadsHistory = downloadsHistory.filter((item) => fs.existsSync(item.filePath));
    return downloadsHistory.map(({ id, filename, completedAt }) => ({ id, filename, completedAt }));
  });
  ipcMain.handle('ljkt:open-downloaded-item', (event, id) => {
    verifySender(event);
    if (typeof id !== 'string') throw new Error('Invalid download reference');
    const savedPath = completedDownloads.get(id);
    if (!savedPath || !fs.existsSync(savedPath))
      throw new Error('Downloaded file is no longer available');
    shell.showItemInFolder(savedPath);
    return true;
  });
  const home = () => window?.loadURL(`${origin}/bot`);
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: '灵境课堂 Bot',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => window?.webContents.send('ljkt:new-chat'),
        },
        { label: '返回Bot首页', accelerator: 'CmdOrCtrl+Home', click: home },
        { label: '打开独立数据目录', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.once('ready-to-show', () => window.show());
  await waitReady();
  await home();
  // Test-only opt-in; never part of ordinary startup.
  if (process.env.LJKT_BOT_SMOKE_TEST === '1') {
    const evidence = await window.webContents.executeJavaScript(`(async()=>{
      const wait=async(check)=>{const start=Date.now();while(!check()&&Date.now()-start<30000)await new Promise(r=>setTimeout(r,100));return !!check();};
      const historyReady=await wait(()=>document.querySelector('.ljbot-new:not([disabled])'));
      document.querySelector('.ljbot-nav')?.click();
      const library=await wait(()=>!!document.querySelector('.ljbot-library[role="dialog"]'));
      document.querySelector('[aria-label="关闭课件库"]')?.click();
      await new Promise(r=>setTimeout(r,200));
      return {title:document.title,composer:!!document.querySelector('.ljbot-composer'),historyReady,library,storageError:!!document.querySelector('.ljbot-error'),nodeExposed:typeof window.require!=='undefined',bridge:typeof window.ljktDesktop?.info==='function'};
    })()`);
    evidence.packaged = app.isPackaged;
    evidence.testedAt = new Date().toISOString();
    await window.webContents.executeJavaScript('document.fonts.ready');
    fs.writeFileSync(
      path.join(logsDir, 'smoke-test.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    fs.writeFileSync(path.join(logsDir, 'smoke-test.json'), JSON.stringify(evidence));
    quitting = true;
    service?.kill();
    app.exit(
      evidence.composer &&
        evidence.historyReady &&
        evidence.library &&
        !evidence.storageError &&
        !evidence.nodeExposed &&
        evidence.bridge
        ? 0
        : 1,
    );
  }
}

app.on('activate', () => {
  if (window) {
    window.show();
    window.focus();
  }
});
app.on('before-quit', () => {
  quitting = true;
  service?.kill();
  log?.end();
});
app.on('will-quit', () => {
  service?.kill();
});
process.on('exit', () => {
  service?.kill();
});
