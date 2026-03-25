const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');

// Server connection config
const WS_URL = 'wss://usurper-reborn.net/ws';
const MUD_HOST = 'usurper-reborn.net';
const MUD_PORT = 4000;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#000000',
    title: 'Usurper Reborn',
    // Custom title bar — dark navy with gold accents (matches WezTerm theme)
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a1a',
      symbolColor: '#c0a050',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', 'app.ico')
  });

  mainWindow.loadFile('renderer.html');

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC: Get connection config
ipcMain.handle('get-config', () => {
  return { wsUrl: WS_URL };
});
