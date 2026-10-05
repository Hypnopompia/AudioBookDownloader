'use strict';

// Renders build/icon.svg to PNG using Electron's own renderer (no extra tools).
//   npx electron scripts/make-icon.js
// Writes build/icon.png (1024px; electron-builder turns it into .icns/.ico)
// and src/assets/icon.png (window/dock icon while running from source).

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(1);
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  const png = img.toPNG();
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);
  fs.mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  console.log('wrote build/icon.png and src/assets/icon.png', img.getSize());
  app.quit();
});
