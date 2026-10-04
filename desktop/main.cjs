// TOWER BREACH desktop shell (Electron): runs the built game (dist/) as a Windows/macOS/Linux app.
// The page is served from a private app:// origin rather than file:// so fetch() (street audio) and
// localStorage (saves, settings) behave exactly as in the browser. Co-op joins dedicated servers by address.
const { app, BrowserWindow, protocol, net, Menu, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

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
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 }); // no escaping dist/
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  // co-op voice chat: the microphone (audio only) for our own bundled page; every other permission is refused
  const ours = (url) => typeof url === 'string' && url.startsWith('app://game');
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(permission === 'media' && ours(details.requestingUrl) && (details.mediaTypes ?? []).every((t) => t === 'audio'));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && ours(origin));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
