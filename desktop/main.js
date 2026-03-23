const { app, BrowserWindow, ipcMain, Menu, MenuItem } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { exec, execSync } = require('child_process');

// ── Resolve the best available python3 path at startup ───────────────────────
// exec() only inherits the Node process's PATH, which may be minimal when
// Electron is launched via a .desktop file or the kjer CLI.  Finding the
// full path once and caching it means backend calls always work regardless.
let PYTHON3_BIN = 'python3';  // fallback: rely on PATH
const PYTHON3_CANDIDATES = [
  path.join(__dirname, '..', '..', 'kjer-venv', 'bin', 'python3'),  // project venv
  '/usr/bin/python3',
  '/usr/local/bin/python3',
  '/bin/python3',
];
for (const candidate of PYTHON3_CANDIDATES) {
  try {
    if (fs.existsSync(candidate)) {
      PYTHON3_BIN = candidate;
      break;
    }
  } catch (_) {}
}

// Base environment for all exec() calls — guarantees python3, apt, sbin tools
// are on PATH even when Electron is launched outside a login shell.
const EXEC_ENV = {
  ...process.env,
  PATH: [
    process.env.PATH || '',
    '/usr/local/sbin', '/usr/local/bin',
    '/usr/sbin', '/usr/bin',
    '/sbin', '/bin',
    '/snap/bin',
  ].filter(Boolean).join(':'),
  DEBIAN_FRONTEND: 'noninteractive',
  DEBCONF_NONINTERACTIVE_SEEN: 'true',
};

// ── In-memory auth session ────────────────────────────────────────────────────
// Lives only in the Node process. Cleared on every app restart.
// The renderer cannot write to this — only read via IPC.
let authSession = { authorized: false, licenseType: 'none', displayVersion: '1.0.0' };
// ─────────────────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'Kjer Security Framework',
  });

  win.loadFile(path.join(__dirname, '../gui/index.html'));

  // Right-click context menu
  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();

    // Text editing actions — only shown when relevant
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut',   label: 'Cut' }));
      menu.append(new MenuItem({ role: 'copy',  label: 'Copy' }));
      menu.append(new MenuItem({ role: 'paste', label: 'Paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll', label: 'Select All' }));
      menu.append(new MenuItem({ type: 'separator' }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy', label: 'Copy' }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Link actions
    if (params.linkURL) {
      menu.append(new MenuItem({
        label: 'Copy Link',
        click: () => win.webContents.clipboard?.writeText(params.linkURL)
             || require('electron').clipboard.writeText(params.linkURL),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Dev tools — only available in dev mode (NODE_ENV=development)
    if (process.env.NODE_ENV === 'development') {
      menu.append(new MenuItem({
        label: 'Inspect Element',
        click: () => win.webContents.inspectElement(params.x, params.y),
      }));
      menu.append(new MenuItem({
        label: win.webContents.isDevToolsOpened() ? 'Close Dev Tools' : 'Open Dev Tools',
        click: () => win.webContents.isDevToolsOpened()
          ? win.webContents.closeDevTools()
          : win.webContents.openDevTools(),
      }));
    }

    if (menu.items.length > 0) menu.popup({ window: win });
  });
}

// IPC: run a system command and return { stdout, stderr, code }
// Timeout is action-aware: install operations can take many minutes (large packages, apt locks);
// quick informational calls keep a short 30s ceiling.
const LONG_RUNNING_ACTIONS = new Set([
  'install', 'uninstall', 'install-profile', 'install-batch', 'run-tool', 'defend-tool',
]);
ipcMain.handle('execute-command', async (event, command, args = []) => {
  return new Promise((resolve) => {
    // args[0] = script path, args[1] = backend action
    const action  = Array.isArray(args) ? (String(args[1] || '')) : '';
    // 900s covers repo setup + apt-get + large package downloads (Splunk ~1.2 GB, Nessus ~850 MB)
    const timeout = LONG_RUNNING_ACTIONS.has(action) ? 900000 : 30000;
    // Resolve python3 to its full discovered path so the call works even when
    // PATH is minimal (e.g. launched from a .desktop file or the kjer CLI).
    const resolvedCommand = command === 'python3' ? PYTHON3_BIN : command;
    const safeArgs = args.map(a => String(a).replace(/"/g, '\\"'));
    const fullCmd  = [resolvedCommand, ...safeArgs.map(a => `"${a}"`)].join(' ');
    exec(fullCmd, { timeout, env: EXEC_ENV }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout  || '',
        stderr: stderr  || '',
        code:   error ? (error.code || 1) : 0,
      });
    });
  });
});

// IPC: return the Kjer root directory (parent of desktop/)
ipcMain.handle('get-app-path', async () => {
  return path.join(__dirname, '..');
});

// IPC: expose the resolved python3 path to the renderer so callBackend can use it
ipcMain.handle('get-python-bin', async () => {
  return PYTHON3_BIN;
});

// IPC: read Kjer/version.json (source-of-truth version for the installed app)
ipcMain.handle('read-version-file', async () => {
  const versionFile = path.join(__dirname, '..', 'version.json');
  try {
    const raw = fs.readFileSync(versionFile, 'utf8');
    return { success: true, data: JSON.parse(raw) };
  } catch (e) {
    return { success: false, data: null, error: e.message };
  }
});

// IPC: read ~/.kjer/install_state.json written by the installer at install time
// Also checks ~/.kjer/initialized flag written by initializeKjer() in the GUI.
ipcMain.handle('read-install-state', async () => {
  const kjierDir     = path.join(os.homedir(), '.kjer');
  const stateFile    = path.join(kjierDir, 'install_state.json');
  const initFlag     = path.join(kjierDir, 'initialized');
  const initialized  = fs.existsSync(initFlag);
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    return { success: true, state: { ...JSON.parse(raw), initialized } };
  } catch (e) {
    // File doesn't exist yet (pre-install) — return null state but still include initialized flag
    return { success: initialized, state: initialized ? { initialized } : null, error: e.message };
  }
});

// IPC: read ~/.kjer/system_analysis.json — written by the CLI's SystemAnalyzer
ipcMain.handle('read-system-analysis', async () => {
  const analysisFile = path.join(os.homedir(), '.kjer', 'system_analysis.json');
  try {
    const raw = fs.readFileSync(analysisFile, 'utf8');
    return { success: true, data: JSON.parse(raw) };
  } catch (e) {
    return { success: false, data: null, error: e.message };
  }
});

// IPC: get real disk usage for the root/system drive using df (Linux/macOS) or wmic (Windows)
ipcMain.handle('get-disk-info', async () => {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd   = isWin
      ? 'wmic logicaldisk where DeviceID="C:" get Size,FreeSpace /format:value'
      : 'df -k /';
    exec(cmd, { timeout: 8000 }, (error, stdout) => {
      if (error || !stdout) return resolve({ success: false });
      try {
        if (isWin) {
          const free  = parseInt((stdout.match(/FreeSpace=(\d+)/) || [])[1] || '0');
          const total = parseInt((stdout.match(/Size=(\d+)/)      || [])[1] || '0');
          resolve({
            success: true,
            total_disk_gb: parseFloat((total / 1e9).toFixed(2)),
            avail_disk_gb: parseFloat((free  / 1e9).toFixed(2)),
          });
        } else {
          // df -k /  output (last non-empty line): Filesystem 1K-blocks Used Available Use% Mount
          const lines = stdout.trim().split('\n').filter(Boolean);
          const parts = lines[lines.length - 1].trim().split(/\s+/);
          const totalBytes = parseInt(parts[1]) * 1024;
          const availBytes = parseInt(parts[3]) * 1024;
          resolve({
            success: true,
            total_disk_gb: parseFloat((totalBytes / 1e9).toFixed(2)),
            avail_disk_gb: parseFloat((availBytes / 1e9).toFixed(2)),
          });
        }
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  });
});

// IPC: write (or update) ~/.kjer/install_state.json  (used by Windows installer path)
ipcMain.handle('write-install-state', async (event, state) => {
  try {
    const kjierDir = path.join(os.homedir(), '.kjer');
    fs.mkdirSync(kjierDir, { recursive: true });
    const stateFile = path.join(kjierDir, 'install_state.json');
    const existing  = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      : {};
    fs.writeFileSync(stateFile, JSON.stringify({ ...existing, ...state }, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// IPC: validate a dev key against ~/Logins/Keys/kjer_dev_key — returns {valid} only, never the key itself
// Also sets the in-memory authSession when the key is valid.
ipcMain.handle('validate-dev-key', async (event, suppliedKey) => {
  try {
    const keyFile = path.join(os.homedir(), 'Logins', 'Keys', 'kjer_dev_key');
    const stored  = fs.readFileSync(keyFile, 'utf8').trim();
    const valid   = typeof suppliedKey === 'string' && suppliedKey.trim().toUpperCase() === stored.toUpperCase();
    if (valid) {
      authSession = { authorized: true, licenseType: 'enterprise', displayVersion: 'developer' };
    }
    return { valid };
  } catch (e) {
    return { valid: false };
  }
});

// IPC: return the current auth session — renderer uses this for all feature gate decisions
ipcMain.handle('get-auth-session', async () => {
  return { ...authSession };
});

// IPC: set auth session from a regular license key validated by the backend
// Also called on startup to restore session from a cached license key
ipcMain.handle('set-license-auth', async (event, data) => {
  if (data && data.authorized) {
    authSession = {
      authorized:     true,
      licenseType:    data.licenseType    || 'personal',
      displayVersion: data.displayVersion || data.version || '1.0.0',
    };
  }
  return { success: true };
});

// IPC: save activity log to ~/.kjer/logs/
// IPC: write any file under the user's home or /tmp — used by report generation
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    // Expand leading ~ to the OS home directory
    const expandedPath = filePath.replace(/^~([/\\]|$)/, os.homedir() + '/');
    const dir = path.dirname(expandedPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(expandedPath, content, 'utf8');
    return { success: true, filePath: expandedPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-activity-log', async (event, content) => {
  try {
    const logsDir = path.join(os.homedir(), '.kjer', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logFile = path.join(logsDir, `kjer-activity-${stamp}.log`);
    fs.writeFileSync(logFile, content, 'utf8');
    return { success: true, filePath: logFile };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Kjer Peer Server (device connection approval) ───────────────────────────
// Listens on KJER_PEER_PORT so other Kjer devices can send connection requests
// and receive approval/denial responses.
const http = require('http');
const KJER_PEER_PORT = 47392;
const _pendingIncomingRequests = []; // { requestId, requesterName, requesterIP, timestamp }

const peerServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  let body = '';
  req.on('data', chunk => { body += chunk.slice(0, 4096); }); // cap at 4 KB
  req.on('end', () => {
    try {
      const data = JSON.parse(body);

      if (req.url === '/connection-request') {
        // Validate required fields — do not trust remote input beyond basic checks
        const requestId     = String(data.requestId     || Date.now()).slice(0, 64);
        const requesterName = String(data.requesterName || 'Unknown').slice(0, 128);
        const requesterIP   = String(data.requesterIP   || req.socket.remoteAddress || '').slice(0, 45);
        const entry = { requestId, requesterName, requesterIP, timestamp: new Date().toISOString() };
        _pendingIncomingRequests.push(entry);
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) wins[0].webContents.send('kjer-connection-request', entry);
        res.writeHead(200);
        res.end(JSON.stringify({ received: true, requestId }));

      } else if (req.url === '/connection-response') {
        const payload = {
          requestId:    String(data.requestId    || '').slice(0, 64),
          approved:     Boolean(data.approved),
          approverName: String(data.approverName || 'Unknown').slice(0, 128),
        };
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) wins[0].webContents.send('kjer-connection-response', payload);
        res.writeHead(200);
        res.end(JSON.stringify({ received: true }));

      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
});
peerServer.on('error', e => console.warn(`Kjer peer server: ${e.message}`));
peerServer.listen(KJER_PEER_PORT, '0.0.0.0');

// IPC: POST a connection request to a remote Kjer device
ipcMain.handle('send-connection-request', async (event, { targetIP, requestId, requesterName, requesterIP }) => {
  return new Promise((resolve) => {
    const body = JSON.stringify({ requestId, requesterName, requesterIP });
    const req  = http.request({
      hostname: targetIP, port: KJER_PEER_PORT,
      path: '/connection-request', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, (res) => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ success: true }));
    });
    req.on('error',   e  => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
});

// IPC: POST approval/denial back to the requesting device
ipcMain.handle('send-connection-response', async (event, { targetIP, requestId, approved, approverName }) => {
  return new Promise((resolve) => {
    const body = JSON.stringify({ requestId, approved, approverName });
    const req  = http.request({
      hostname: targetIP, port: KJER_PEER_PORT,
      path: '/connection-response', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, (res) => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ success: true }));
    });
    req.on('error',   e  => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
});

// IPC: return all pending incoming requests (for renderer startup catch-up)
ipcMain.handle('get-pending-requests', async () => [..._pendingIncomingRequests]);

// IPC: clear a handled pending request
ipcMain.handle('clear-pending-request', async (event, requestId) => {
  const idx = _pendingIncomingRequests.findIndex(r => r.requestId === requestId);
  if (idx !== -1) _pendingIncomingRequests.splice(idx, 1);
  return { success: true };
});
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

// Signal renderer to auto-save log before quitting
let _autoSaveTriggered = false;
app.on('before-quit', (e) => {
  if (!_autoSaveTriggered) {
    _autoSaveTriggered = true;
    e.preventDefault();
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      wins[0].webContents.send('app-before-quit');
    }
    // Allow up to 1.5s for renderer to save, then force quit
    setTimeout(() => app.quit(), 1500);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

