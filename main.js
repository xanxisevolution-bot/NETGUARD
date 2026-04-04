// ============================================================
//  NetGuard Monitor v2.0 — Electron Main Process
//  Starts backend server + System Tray
// ============================================================

const { app, BrowserWindow, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const { startServer, PORT } = require('./server');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); return; }

let mainWindow = null;
let tray = null;
let isQuitting = false;
let server = null;

const CONFIG = {
  width: 1400,
  height: 900,
  minWidth: 900,
  minHeight: 600,
  startMinimized: true,
  notified: false,
};

// ============================================================
//  Create Window
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: CONFIG.width,
    height: CONFIG.height,
    minWidth: CONFIG.minWidth,
    minHeight: CONFIG.minHeight,
    show: !CONFIG.startMinimized,
    icon: path.join(__dirname, 'icon.ico'),
    title: 'NetGuard - Internet Monitor',
    autoHideMenuBar: true,
    backgroundColor: '#0B0E14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load from local server
  mainWindow.loadURL(`http://localhost:${PORT}/dashboard.html`);

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (!CONFIG.notified && tray) {
        showNotification('NetGuard is running', 'Hidden in System Tray. Click icon to open.');
        CONFIG.notified = true;
      }
    }
  });

  mainWindow.on('minimize', () => mainWindow.hide());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================================
//  Create Tray
// ============================================================
function createTray() {
  let trayIcon;
  const trayPath = path.join(__dirname, 'tray-icon.png');

  try {
    trayIcon = nativeImage.createFromPath(trayPath);
    if (trayIcon.isEmpty()) throw new Error('empty');
  } catch {
    trayIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAJlJREFUWEft1LEKwCAQA9D8/0drB+didRBOnQJCOb3kEuU0M/Pi+Xq9P1+s8wRnQAzgDY6ZBiGScABigJKNEU9iACVADCDZVIcRPYkBKgExQNImHyN6EgNUAmIAyaY6jOhJDFAJiAGSNvkY0ZMYoBIQA0g21WFET2KASkAMkLTJx4iexACVgBhAsqkOI3oSA1QCYoD/Db8bZlEhpR+NJAAAAABJRU5ErkJggg=='
    );
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('NetGuard - Internet Monitor');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Refresh Scan',
      click: () => {
        if (mainWindow) mainWindow.webContents.executeJavaScript('scanAll()');
      },
    },
    { label: 'Reload Page', click: () => { if (mainWindow) mainWindow.reload(); } },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked, path: process.execPath });
      },
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => { if (mainWindow) mainWindow.setAlwaysOnTop(menuItem.checked); },
    },
    { type: 'separator' },
    { label: 'Quit NetGuard', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.isMinimized()) mainWindow.restore();
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

// ============================================================
//  App Lifecycle
// ============================================================
app.whenReady().then(async () => {
  // Start backend server first
  server = await startServer();
  console.log('Backend server started');

  createWindow();
  createTray();

  if (CONFIG.startMinimized && mainWindow) {
    mainWindow.hide();
  }
});

app.on('second-instance', () => showWindow());
app.on('window-all-closed', () => { /* keep running in tray */ });
app.on('before-quit', () => { isQuitting = true; });
app.on('activate', () => { if (!mainWindow) createWindow(); });
