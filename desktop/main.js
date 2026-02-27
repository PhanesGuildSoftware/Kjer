const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { exec } = require('child_process');

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
}

// IPC: run a system command and return { stdout, stderr, code }
ipcMain.handle('execute-command', async (event, command, args = []) => {
  return new Promise((resolve) => {
    const safeArgs = args.map(a => String(a).replace(/"/g, '\\"'));
    const fullCmd  = [command, ...safeArgs.map(a => `"${a}"`)].join(' ');
    exec(fullCmd, { timeout: 30000 }, (error, stdout, stderr) => {
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

app.whenReady().then(createWindow);

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

