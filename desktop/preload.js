// preload.js — contextBridge between renderer (gui/app.js) and main process
// Exposes a safe electronAPI surface under window.electronAPI.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Run a system command via the main process.
     * @param {string} command - e.g. 'python3', 'bash', 'powershell'
     * @param {string[]} args   - arguments to pass
     * @returns {Promise<{stdout:string, stderr:string, code:number}>}
     */
    executeCommand: (command, args) =>
        ipcRenderer.invoke('execute-command', command, args),

    /**
     * Get the Kjer root directory (parent of the desktop/ folder).
     * @returns {Promise<string>}
     */
    getAppPath: () =>
        ipcRenderer.invoke('get-app-path'),

    /**
     * Read Kjer/version.json — the canonical version of the installed app.
     * @returns {Promise<{success:boolean, data:{version,channel,...}|null}>}
     */
    readVersionFile: () =>
        ipcRenderer.invoke('read-version-file'),

    /**
     * Read ~/.kjer/install_state.json written by the installer.
     * Returns { success, state: { os, distro, installed_at, install_path } | null }
     * @returns {Promise<{success:boolean, state:object|null}>}
     */
    getInstallState: () =>
        ipcRenderer.invoke('read-install-state'),

    /**
     * Write (merge) fields into ~/.kjer/install_state.json.
     * Used by the Windows installer path and first-run detection.
     * @param {object} state - fields to merge into install_state.json
     * @returns {Promise<{success:boolean}>}
     */
    writeInstallState: (state) =>
        ipcRenderer.invoke('write-install-state', state),
});
