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

    getPythonBin: () =>
        ipcRenderer.invoke('get-python-bin'),

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

    /**
     * Read ~/.kjer/system_analysis.json written by `kjer-cli.py --analyze`.
     * Returns { success, data: { detected_tools: {name: {installed,path,version}}, ...} | null }
     * @returns {Promise<{success:boolean, data:object|null}>}
     */
    readSystemAnalysis: () =>
        ipcRenderer.invoke('read-system-analysis'),

    /**
     * Get real disk usage for the root/system drive.
     * Returns { success, total_disk_gb, avail_disk_gb }
     */
    getDiskInfo: () =>
        ipcRenderer.invoke('get-disk-info'),

    /**
     * Save the activity log to ~/.kjer/logs/kjer-activity-<timestamp>.log
     * @param {string} content - formatted log text
     * @returns {Promise<{success:boolean, filePath:string}>}
     */
    saveActivityLog: (content) =>
        ipcRenderer.invoke('save-activity-log', content),

    /**
     * Validate a supplied key against the dev key file on disk.
     * Returns { valid: boolean } — the actual key is never sent back.
     * Also sets the in-memory auth session in main process on success.
     * @param {string} key
     * @returns {Promise<{valid:boolean}>}
     */
    validateDevKey: (key) =>
        ipcRenderer.invoke('validate-dev-key', key),

    /**
     * Get the current auth session from the main process.
     * Use this for all feature gate decisions — never trust localStorage for gates.
     * @returns {Promise<{authorized:boolean, licenseType:string, displayVersion:string}>}
     */
    getAuthSession: () =>
        ipcRenderer.invoke('get-auth-session'),

    /**
     * Set the auth session in the main process from a validated regular license key.
     * @param {{authorized:boolean, licenseType:string, displayVersion:string}} data
     * @returns {Promise<{success:boolean}>}
     */
    setLicenseAuth: (data) =>
        ipcRenderer.invoke('set-license-auth', data),

    /**
     * Register a callback invoked by main when the app is about to quit.
     * Use this to trigger auto-save of the activity log.
     * @param {Function} callback
     */
    onBeforeQuit: (callback) =>
        ipcRenderer.on('app-before-quit', callback),

    /**
     * Send a connection request to a remote Kjer device.
     * @param {{targetIP, requestId, requesterName, requesterIP}} data
     */
    sendConnectionRequest: (data) =>
        ipcRenderer.invoke('send-connection-request', data),

    /**
     * Send an approval or denial back to the requesting device.
     * @param {{targetIP, requestId, approved, approverName}} data
     */
    sendConnectionResponse: (data) =>
        ipcRenderer.invoke('send-connection-response', data),

    /** Get all pending incoming connection requests (pre-window-ready). */
    getPendingRequests: () =>
        ipcRenderer.invoke('get-pending-requests'),

    /** Remove a handled pending request from the main-process queue. */
    clearPendingRequest: (requestId) =>
        ipcRenderer.invoke('clear-pending-request', requestId),

    /**
     * Write a text file to disk (used by report generation).
     * Supports ~ for home directory.
     * @param {string} filePath - destination path (may start with ~)
     * @param {string} content  - file contents
     * @returns {Promise<{success:boolean, filePath?:string, error?:string}>}
     */
    writeFile: (filePath, content) =>
        ipcRenderer.invoke('write-file', filePath, content),

    /** Listen for incoming connection requests pushed from the main process. */
    onConnectionRequest: (callback) =>
        ipcRenderer.on('kjer-connection-request', (_event, data) => callback(data)),

    /** Listen for connection responses (approval/denial) from remote devices. */
    onConnectionResponse: (callback) =>
        ipcRenderer.on('kjer-connection-response', (_event, data) => callback(data)),
});
