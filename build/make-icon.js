// Regenerates the app icon (icon.png 512px + icon.ico with 256/128/64/48/32/16 PNG entries) from the SVG below.
// Run from the project folder: npx electron build/make-icon.js   (dev tooling, not packed in the installer)
// Rebrand: edit the SVG (or drop your own icon.ico / icon.png here) and rerun.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');
const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" style="display:block">
<rect width="512" height="512" rx="116" fill="#111111"/>
<g fill="#ffffff">
  <rect x="186" y="238" width="140" height="36" rx="8"/>
  <rect x="150" y="158" width="44" height="196" rx="12"/>
  <rect x="318" y="158" width="44" height="196" rx="12"/>
  <rect x="108" y="192" width="36" height="128" rx="12"/>
  <rect x="368" y="192" width="36" height="128" rx="12"/>
  <rect x="86" y="244" width="24" height="24" rx="6"/>
  <rect x="402" y="244" width="24" height="24" rx="6"/>
</g></svg></body></html>`;

// .ico container: 6-byte header, one 16-byte directory entry per image, then the PNG data (Vista+ reads PNG entries)
function ico(entries) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = 6 + 16 * entries.length; const dirs = [];
  for (const { size, png } of entries) {
    const d = Buffer.alloc(16); d[0] = size === 256 ? 0 : size; d[1] = d[0]; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(png.length, 8); d.writeUInt32LE(off, 12);
    dirs.push(d); off += png.length;
  }
  return Buffer.concat([head, ...dirs, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  // a transparent frameless window renders the SVG with antialiasing; capturePage keeps the alpha (and returns device pixels on a scaled display)
  const win = new BrowserWindow({ width: 512, height: 512, useContentSize: true, frame: false, transparent: true, resizable: false, alwaysOnTop: true, show: true });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const shot = await win.capturePage();
  const base = shot.getSize().width === 512 ? shot : shot.resize({ width: 512, height: 512, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), base.toPNG());
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico([256, 128, 64, 48, 32, 16].map((size) => ({ size, png: base.resize({ width: size, height: size, quality: 'best' }).toPNG() }))));
  console.log('icon.png + icon.ico written, ico reads as', nativeImage.createFromPath(path.join(__dirname, 'icon.ico')).getSize());
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
