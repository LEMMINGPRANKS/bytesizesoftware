const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const HTML = path.resolve(__dirname, '..', 'wildcraft.html');
const ICON = path.join(__dirname, 'icon.png');
const WIN_W = 1280;
const WIN_H = 720;

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
  win.loadFile(HTML);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
