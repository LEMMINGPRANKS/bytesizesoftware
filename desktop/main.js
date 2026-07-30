const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// In dev (npm start) the bundle lives at ../wildcraft.html next to the
// desktop/ folder. Once packaged into an AppImage, electron-builder copies
// it into process.resourcesPath via extraResources.
const HTML = app.isPackaged
  ? path.join(process.resourcesPath, 'wildcraft.html')
  : path.resolve(__dirname, '..', 'wildcraft.html');
const ICON = path.join(__dirname, 'icon.png');
const WIN_W = 1280;
const WIN_H = 720;
// Fixed port so the origin (and therefore localStorage) is stable across
// launches and version bumps. Random/uncommon port to avoid clashes.
const PORT = 18736;
const HOST = '127.0.0.1';

// Serve wildcraft.html over http://127.0.0.1:PORT so Chromium treats it
// as a real, persistent origin. file:// origins are opaque in modern
// Chromium and their localStorage can be discarded at session end — which
// was eating the player's saves on every restart. Fixed port so the
// origin (and therefore localStorage) stays identical across launches.
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      fs.readFile(HTML, (err, buf) => {
        if (err) {
          res.writeHead(500);
          res.end('wildcraft bundle missing');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

let httpServer = null;

function createWindow() {
  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    minWidth: 960,
    minHeight: 540,
    title: 'Wildcraft',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#6b8cff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(`http://${HOST}:${PORT}/`);
}

app.whenReady().then(async () => {
  try { httpServer = await startServer(); }
  catch (e) {
    // Port already in use (likely another Wildcraft instance). Try to
    // connect to the existing one instead.
    console.error('http server failed:', e.message);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (httpServer) { httpServer.close(); httpServer = null; }
  if (process.platform !== 'darwin') app.quit();
});
