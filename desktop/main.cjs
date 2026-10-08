// TOWER BREACH desktop shell (Electron): runs the built game (dist/) as a Windows/macOS/Linux app.
// The page is served from a private app:// origin rather than file:// so fetch() (street audio) and
// localStorage (saves, settings) behave exactly as in the browser. Co-op joins dedicated servers by address.
const { app, BrowserWindow, protocol, net, Menu, session, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
// moddable folders (posters, street audio) are unpacked next to the app archive so players can drop files in
const MODDABLE = DIST.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
const fs = require('node:fs');

// laptops with two GPUs: always render on the fast one
app.commandLine.appendSwitch('force_high_performance_gpu');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#030405', title: 'Tower Breach', autoHideMenuBar: true,
    // app:// is a secure origin, so Chromium would block plain ws:// to a dedicated server as mixed content.
    // Only our own bundled pages ever load in this window (no remote content), so allowing it is safe here.
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, allowRunningInsecureContent: true },
  });
  // `--perf` (e.g. "Tower Breach.exe" --perf): floor-change timing in a detached DevTools console (docs/DEVELOPMENT.md)
  const perf = process.argv.includes('--perf');
  win.loadURL(perf ? 'app://game/index.html?perf=1' : 'app://game/index.html');
  if (perf) win.webContents.openDevTools({ mode: 'detach' });
  // keep the window on the bundled game (that's what makes allowRunningInsecureContent safe)
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://game/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // F11 toggles fullscreen; the game itself owns every other key
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const root = /^\/(posters|audio)\//.test(rel) ? MODDABLE : DIST;
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 }); // no escaping dist/ (or into a sibling like dist-x)
    if (rel === '/posters/index.json') { // drop-in posters: list the folder as it is now
      let names = [];
      try { names = fs.readdirSync(path.join(MODDABLE, 'posters')).filter((n) => /\.jpe?g$/i.test(n)).sort(); } catch { /* no folder: no posters */ }
      return new Response(JSON.stringify(names), { headers: { 'content-type': 'application/json' } });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  // co-op voice chat: the microphone (audio only) for our own bundled page; every other permission is refused
  const ours = (url) => typeof url === 'string' && url.startsWith('app://game');
  session.defaultSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const ok = permission === 'media' && ours(details.requestingUrl) && (details.mediaTypes ?? []).every((t) => t === 'audio');
    if (!ok || process.platform !== 'darwin') return callback(ok);
    // macOS feeds the app silence unless the app itself has microphone access: ask once, and refuse when the user
    // said no so the game can tell them where to turn it on (instead of "transmitting" nothing)
    const st = systemPreferences.getMediaAccessStatus('microphone');
    callback(st === 'granted' || (st === 'not-determined' && (await systemPreferences.askForMediaAccess('microphone'))));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && ours(origin));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
