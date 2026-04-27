const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Persistent client-side state (window bounds, future: client prefs).
// electron-store writes JSON to %APPDATA%/usurper-reborn/config.json (or
// platform equivalent). Survives app restart, separate from game saves.
const Store = require('electron-store');
const store = new Store({
  defaults: {
    windowBounds: { width: 1100, height: 750 },
    windowMaximized: false,
  }
});

// No auto-updater: distribution goes through Steam, which handles updates
// outside the Electron app. The C# binary inside still does its own
// version check (per CLAUDE.md, in non-Steam contexts) but the Electron
// shell itself updates when Steam updates the depot.

// ─── Platform detection ──────────────────────
//
// The C# game publishes self-contained binaries for win-x64 / win-x86 /
// linux-x64 / linux-arm64 / osx-x64 (per CLAUDE.md). The Electron app needs
// to spawn the right one for the host platform. In development we look in
// `../publish/<rid>/`; in a packaged app the binary lives in
// `process.resourcesPath/game/` thanks to electron-builder's extraResources.

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

function getPlatformRid() {
  // Match electron-builder's runtime-identifier shape.
  if (IS_WINDOWS) {
    return process.arch === 'ia32' ? 'win-x86' : 'win-x64';
  }
  if (IS_MACOS) {
    return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  }
  if (IS_LINUX) {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  // Fallback — let the spawn fail with a clear "not found" error.
  return 'unknown';
}

function getBinaryName() {
  return IS_WINDOWS ? 'UsurperReborn.exe' : 'UsurperReborn';
}

function resolveGameBinary() {
  const binaryName = getBinaryName();

  // Packaged build: electron-builder ships the C# binary inside resources/game/.
  // app.isPackaged is the canonical "are we running from an installer" check.
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'game', binaryName);
    if (fs.existsSync(packaged)) return packaged;
  }

  // Dev: look in the appropriate publish/<rid>/ first, falling back to the
  // legacy publish/local/ for Windows-only dev workflows that pre-date the rid split.
  const rid = getPlatformRid();
  const candidates = [
    path.join(__dirname, '..', 'publish', rid, binaryName),
    path.join(__dirname, '..', 'publish', 'local', binaryName), // legacy Windows dev path
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Return the first candidate even if missing — caller will surface the
  // descriptive "binary not found" error to the renderer.
  return candidates[0];
}

// CP437 → Unicode lookup table (the game outputs CP437 in --stdio mode)
const CP437 = [
  '\u0000','\u263A','\u263B','\u2665','\u2666','\u2663','\u2660','\u2022',
  '\u25D8','\u25CB','\u25D9','\u2642','\u2640','\u266A','\u266B','\u263C',
  '\u25BA','\u25C4','\u2195','\u203C','\u00B6','\u00A7','\u25AC','\u21A8',
  '\u2191','\u2193','\u2192','\u2190','\u221F','\u2194','\u25B2','\u25BC',
  ' ','!','"','#','$','%','&',"'",'(',')','*','+',',','-','.','/',
  '0','1','2','3','4','5','6','7','8','9',':',';','<','=','>','?',
  '@','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O',
  'P','Q','R','S','T','U','V','W','X','Y','Z','[','\\',']','^','_',
  '`','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o',
  'p','q','r','s','t','u','v','w','x','y','z','{','|','}','~','\u2302',
  '\u00C7','\u00FC','\u00E9','\u00E2','\u00E4','\u00E0','\u00E5','\u00E7',
  '\u00EA','\u00EB','\u00E8','\u00EF','\u00EE','\u00EC','\u00C4','\u00C5',
  '\u00C9','\u00E6','\u00C6','\u00F4','\u00F6','\u00F2','\u00FB','\u00F9',
  '\u00FF','\u00D6','\u00DC','\u00A2','\u00A3','\u00A5','\u20A7','\u0192',
  '\u00E1','\u00ED','\u00F3','\u00FA','\u00F1','\u00D1','\u00AA','\u00BA',
  '\u00BF','\u2310','\u00AC','\u00BD','\u00BC','\u00A1','\u00AB','\u00BB',
  '\u2591','\u2592','\u2593','\u2502','\u2524','\u2561','\u2562','\u2556',
  '\u2555','\u2563','\u2551','\u2557','\u255D','\u255C','\u255B','\u2510',
  '\u2514','\u2534','\u252C','\u251C','\u2500','\u253C','\u255E','\u255F',
  '\u255A','\u2554','\u2569','\u2566','\u2560','\u2550','\u256C','\u2567',
  '\u2568','\u2564','\u2565','\u2559','\u2558','\u2552','\u2553','\u256B',
  '\u256A','\u2518','\u250C','\u2588','\u2584','\u258C','\u2590','\u2580',
  '\u03B1','\u00DF','\u0393','\u03C0','\u03A3','\u03C3','\u00B5','\u03C4',
  '\u03A6','\u0398','\u03A9','\u03B4','\u221E','\u03C6','\u03B5','\u2229',
  '\u2261','\u00B1','\u2265','\u2264','\u2320','\u2321','\u00F7','\u2248',
  '\u00B0','\u2219','\u00B7','\u221A','\u207F','\u00B2','\u25A0','\u00A0',
];

function cp437ToUtf8(buffer) {
  let out = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    // Preserve control characters (0x00-0x1F, 0x7F) — needed for ANSI escapes, \r, \n, etc.
    if (byte < 0x20 || byte === 0x7F) {
      out += String.fromCharCode(byte);
    } else {
      out += CP437[byte];
    }
  }
  return out;
}

// Connection modes
const MODE_LOCAL = 'local';       // Spawn local game binary
const MODE_ONLINE = 'online';     // WebSocket to server

// Config
const WS_URL = 'wss://usurper-reborn.net/ws';
// Binary path is resolved at spawn time via resolveGameBinary() so dev / packaged
// / cross-platform all pick up the right RID without any code changes.

let mainWindow = null;
let gameProcess = null;
let connectionMode = MODE_LOCAL; // Default to single-player

// macOS uses a different title bar style than Windows/Linux. The titleBarOverlay
// option only works on Windows and Linux; on macOS we use hiddenInset which
// retains the traffic-light buttons inset into the window chrome.
function getTitleBarOptions() {
  if (IS_MACOS) {
    return { titleBarStyle: 'hiddenInset' };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a1a',
      symbolColor: '#c0a050',
      height: 32
    }
  };
}

function createWindow() {
  // Restore previous window bounds. Defensive default values are baked into
  // the Store schema above so a corrupt config.json can't crash the app.
  const bounds = store.get('windowBounds');
  const wasMaximized = store.get('windowMaximized');

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 550,
    backgroundColor: '#000000',
    title: 'Usurper Reborn',
    ...getTitleBarOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Disable Electron's background-frame throttling — without this the game
      // gets choppy input handling whenever the window loses focus, which makes
      // alt-tabbing during combat feel terrible.
      backgroundThrottling: false
    },
    // Icon: app.ico is Windows-only. Linux + macOS get their icons from the
    // bundled .desktop file / .icns respectively (handled by electron-builder).
    // For dev runs, the .ico fallback is fine on all platforms (Electron just
    // shows a default icon if it can't load).
    icon: path.join(__dirname, '..', 'app.ico')
  });

  if (wasMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile('renderer.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Parse CLI args
  if (process.argv.includes('--online')) {
    connectionMode = MODE_ONLINE;
  }

  // Persist window bounds on resize/move. Debouncing isn't strictly needed —
  // electron-store batches writes — but we'd add it here if the rate became a problem.
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
    store.set('windowMaximized', mainWindow.isMaximized());
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('maximize', persistBounds);
  mainWindow.on('unmaximize', persistBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
    killGameProcess();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  killGameProcess();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ─── IPC Handlers ──────────────────────────

// Get connection config
ipcMain.handle('get-config', () => {
  return {
    mode: connectionMode,
    wsUrl: WS_URL,
  };
});

// Spawn the local game process
ipcMain.handle('spawn-game', () => {
  if (gameProcess) {
    return { ok: true, message: 'Already running' };
  }

  const binary = resolveGameBinary();
  // Validate before spawning so we can surface a clean "your install is broken"
  // message instead of an opaque ENOENT from spawn().
  if (!fs.existsSync(binary)) {
    const message = `Game binary not found at: ${binary}\n\n` +
      `Platform: ${process.platform}-${process.arch} (RID: ${getPlatformRid()})\n` +
      `Packaged build: ${app.isPackaged}\n\n` +
      (app.isPackaged
        ? `This indicates a corrupted install. Reinstall from the source you got it from.`
        : `For development, run \`dotnet publish usurper-reloaded.csproj -c Release -r ${getPlatformRid()} --self-contained -o publish/${getPlatformRid()}\` from the repo root first.`);
    console.error(message);
    return { ok: false, message };
  }

  try {
    // CWD: anchor to the binary's own directory so any DATA/, SCORES/, logs/
    // CWD-relative paths the C# game uses land alongside the binary instead
    // of polluting the Electron app dir or the user's home. This is also
    // necessary for save files which use SaveSystem's path resolution.
    const cwd = path.dirname(binary);

    gameProcess = spawn(binary, ['--local', '--electron'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd,
      windowsHide: true,
    });

    gameProcess.on('error', (err) => {
      console.error('Game process error:', err.message);
      if (mainWindow) {
        mainWindow.webContents.send('game-error', err.message);
      }
      gameProcess = null;
    });

    gameProcess.on('exit', (code) => {
      console.log('Game process exited with code', code);
      if (mainWindow) {
        mainWindow.webContents.send('game-exit', code);
      }
      gameProcess = null;
    });

    // Pipe game stdout to renderer. CP437 conversion is Windows-only — the
    // .NET runtime defaults Console.OutputEncoding to CP437 when stdout is
    // redirected on Windows (legacy console behaviour), but emits UTF-8 on
    // Linux/macOS. Running CP437 conversion on UTF-8 corrupts multi-byte chars.
    if (IS_WINDOWS) {
      gameProcess.stdout.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('game-data', cp437ToUtf8(data));
        }
      });
    } else {
      gameProcess.stdout.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('game-data', data.toString('utf8'));
        }
      });
    }

    // Pipe game stderr for debug logging
    gameProcess.stderr.on('data', (data) => {
      console.error('[game stderr]', data.toString());
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// Send input to the game process
ipcMain.on('game-input', (_event, data) => {
  if (gameProcess && gameProcess.stdin.writable) {
    gameProcess.stdin.write(data);
  }
});

function killGameProcess() {
  if (gameProcess) {
    try {
      gameProcess.kill();
    } catch (e) { /* ignore */ }
    gameProcess = null;
  }
}
