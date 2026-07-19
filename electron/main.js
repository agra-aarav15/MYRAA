import { app, BrowserWindow, Tray, Menu, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let tray;
let serverProcess;

function startBackendServer() {
  return new Promise((resolve) => {
    // Check if port 3001 is already running
    http.get('http://localhost:3001/api/health', (res) => {
      console.log('[Electron] Backend server already running on port 3001.');
      resolve(true);
    }).on('error', () => {
      console.log('[Electron] Starting backend server.js...');
      const serverPath = path.join(__dirname, '../server.js');
      serverProcess = spawn(process.execPath, [serverPath], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: { ...process.env, PORT: '3001' }
      });

      // Wait a moment for server to bind
      setTimeout(() => resolve(true), 1500);
    });
  });
}

async function createWindow() {
  await startBackendServer();

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'MYRAA // AARAV COMPANION',
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allow local audio/video stream processing
    }
  });

  // Check if dev or production
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load Vite build dist
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createTray();
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../public/favicon.svg');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open MYRAA Companion', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else { createWindow(); } } },
      { type: 'separator' },
      { label: 'Quit MYRAA', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('MYRAA // AARAV Companion');
    tray.setContextMenu(contextMenu);
  } catch (e) {
    console.log('[Electron] Tray creation skipped:', e.message);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverProcess) serverProcess.kill();
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
