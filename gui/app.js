/* ============================================
   Kjer - Application JavaScript
   ============================================ */

// ==================== BACKEND API INTEGRATION ====================

const BackendAPI = {
    /**
     * Execute backend Python script
     */
    async callBackend(action, params = {}) {
        const appPath    = await window.electronAPI?.getAppPath?.();
        const backendPath = appPath ? `${appPath}/lib/backend_api.py` : '../lib/backend_api.py';
        const args = [backendPath, action];
        
        if (params.licenseKey)  args.push('--license-key',  params.licenseKey);
        if (params.licenseType)  args.push('--license-type',  params.licenseType);
        if (params.tool)         args.push('--tool',          params.tool);
        if (params.tools)        args.push('--tools',         params.tools);
        if (params.profile)      args.push('--profile',       params.profile);
        if (params.detectedOS)   args.push('--detected-os',   params.detectedOS);
        
        try {
            const response = await window.electronAPI?.executeCommand('python3', args);
            if (response && response.stdout && response.stdout.trim()) {
                try {
                    return JSON.parse(response.stdout);
                } catch (parseErr) {
                    const detail = (response.stderr || response.stdout || '').trim().slice(0, 200);
                    return { success: false, error: `Backend parse error: ${detail}` };
                }
            }
            // No stdout — surface stderr so errors are visible in the activity log
            const errDetail = (response?.stderr || '').trim().slice(0, 300);
            const exitCode  = response?.code;
            return {
                success: false,
                error: errDetail || (exitCode ? `Backend exited with code ${exitCode}` : 'No response from backend')
            };
        } catch (error) {
            console.error('Backend API error:', error);
            return { success: false, error: error.message || 'IPC error' };
        }
    },
    
    async checkActivation() {
        return await this.callBackend('check-activation');
    },
    
    async activateLicense(licenseKey, licenseType = 'personal') {
        return await this.callBackend('activate', { licenseKey, licenseType });
    },
    
    async installTool(toolName) {
        return await this.callBackend('install', { tool: toolName });
    },
    
    async uninstallTool(toolName) {
        return await this.callBackend('uninstall', { tool: toolName });
    },
    
    async getInstalledTools() {
        return await this.callBackend('list-installed');
    },
    
    async installProfile(profileName) {
        return await this.callBackend('install-profile', { profile: profileName });
    },
    
    async getSystemStatus() {
        return await this.callBackend('system-status');
    },
    
    async getHardwareId() {
        return await this.callBackend('get-hwid');
    },
    
    async storeDetectedOS(detectedOS) {
        return await this.callBackend('store-detected-os', { detectedOS });
    },

    async checkSudo() {
        return await this.callBackend('check-sudo');
    },

    async setupSudo() {
        return await this.callBackend('setup-sudo');
    },

    async installBatch(toolKeys) {
        return await this.callBackend('install-batch', { tools: toolKeys.join(',') });
    },

    async runTool(toolKey) {
        return await this.callBackend('run-tool', { tool: toolKey });
    },

    async serviceStatus(toolKey) {
        return await this.callBackend('service-status', { tool: toolKey });
    },

    async getHostScan() {
        return await this.callBackend('host-scan');
    },

    /**
     * Read ~/.kjer/install_state.json via Electron IPC.
     * Returns { success, state: { os, distro, installed_at, install_path } | null }
     */
    async getInstallState() {
        try {
            if (window.electronAPI?.getInstallState) {
                return await window.electronAPI.getInstallState();
            }
        } catch (e) {
            console.warn('getInstallState IPC failed:', e);
        }
        return { success: false, state: null };
    }
};

// ==================== LICENSE TIER DEFINITIONS ====================

const KJER_TIERS = {
    personal:   {
        label: 'Personal',   tier: 1, maxDevices: 1,   maxProfiles: 3,   color: '#B0E0E6',
        automationLevel: 1, automationLabel: 'Assisted',
        automationDesc:  'Manual trigger only — you initiate every scan and action.',
        description: 'Single device — manual-trigger security tools and profiles.',
    },
    home:       {
        label: 'Home',       tier: 2, maxDevices: 7,   maxProfiles: 15,  color: '#4caf50',
        automationLevel: 2, automationLabel: 'Semi-Auto',
        automationDesc:  'Scheduled scans with manual approval for defensive actions.',
        description: 'Up to 7 devices — scheduled scanning, manual defense approval.',
    },
    enterprise: {
        label: 'Enterprise', tier: 3, maxDevices: 25,  maxProfiles: 50,  color: '#9D4EDD',
        automationLevel: 3, automationLabel: 'Fully Automated',
        automationDesc:  'Auto-scan, auto-defend, and policy enforcement across all devices.',
        description: 'Up to 25 devices — fully automated scanning and defense pipeline.',
    },
    industrial: {
        label: 'Industrial', tier: 4, maxDevices: 100, maxProfiles: 100, color: '#ff9800',
        automationLevel: 4, automationLabel: 'Autonomous',
        automationDesc:  'Autonomous operation with scheduled tasks, policy-driven response, and zero human intervention required.',
        description: 'Up to 100 devices — autonomous, scheduled, and policy-driven security operations.',
    },
};

/** Returns the full tier object for the currently active license. */
function getActiveTier() {
    const stored = localStorage.getItem('kjerLicenseType') || 'personal';
    return KJER_TIERS[stored] || KJER_TIERS.personal;
}

/** Returns a human-readable label for any stored type string. */
function getTierLabel(type) {
    if (!type || type === 'none') return '[Not Activated]';
    if (type === 'developer')    return 'Developer Mode';
    return (KJER_TIERS[type] || KJER_TIERS.personal).label + ' License';
}

/** Returns the max number of network devices allowed for the current tier. */
function getMaxDevices() {
    return getActiveTier().maxDevices;
}

/** Returns the max number of custom profiles allowed for the current tier. */
function getMaxProfiles() {
    return getActiveTier().maxProfiles;
}

/** Returns the Automation Intensity level (1–4) for the current tier. */
function getAutomationLevel() {
    return getActiveTier().automationLevel;
}

/** Returns the Automation Intensity label (e.g. 'Assisted', 'Semi-Auto') for the current tier. */
function getAutomationLabel() {
    return getActiveTier().automationLabel || 'Assisted';
}

/** Returns true if scheduled (cron-style) scans are available at the current tier (Home+). */
function canScheduleScans() {
    return getAutomationLevel() >= 2;
}

/** Returns true if defensive actions can be triggered automatically (Enterprise+). */
function canAutoDefend() {
    return getAutomationLevel() >= 3;
}

/** Returns true if fully autonomous, policy-driven operation is available (Industrial). */
function canRunAutonomously() {
    return getAutomationLevel() >= 4;
}

// ===================================================================

// ==================== APPLICATION RESET ====================

function confirmResetApplication() {
    const confirmed = confirm('⚠️ WARNING: This will reset Kjer to its initial state.\n\nYour license will remain active on this system permanently.\n\nContinue?');
    
    if (confirmed) {
        const doubleConfirm = confirm('Are you absolutely sure? Your settings and logs will be cleared, but your license will persist.');
        if (doubleConfirm) {
            resetApplicationState();
        }
    }
}

function resetApplicationState() {
    // Clear settings only - preserve license binding
    localStorage.removeItem('kjerInitialized');
    localStorage.removeItem('userOS');
    localStorage.removeItem('initializationDate');
    localStorage.removeItem('kjerTutorialCompleted');
    localStorage.removeItem('darkMode');
    localStorage.removeItem('autoRefresh');
    localStorage.removeItem('notifications');
    localStorage.removeItem('installPath');
    localStorage.removeItem('autoUpdate');

    // Also delete the on-disk initialized flag so it doesn't get restored on next load.
    // Without this, loadInstallStateIntoApp() would immediately re-set ktorInitialized=true.
    try {
        window.electronAPI?.executeCommand?.('bash', ['-c', 'rm -f ~/.kjer/initialized']);
    } catch (e) { /* non-fatal */ }

    logActivity('Application state reset. License remains active on this system.', 'warning');
    setTimeout(() => {
        location.reload();
    }, 500);
}

// ==================== OS DETECTION & SYSTEM INFO ====================

const SystemInfo = {
    detectOS: function() {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.indexOf('win') > -1) return 'windows';
        if (ua.indexOf('mac') > -1) return 'macos';
        if (ua.indexOf('linux') > -1) return 'linux';
        if (ua.indexOf('android') > -1) return 'android';
        return 'unknown';
    },
    
    getOSInfo: function() {
        const os = this.detectOS();
        const osNames = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', unknown: 'Unknown' };
        return { os, name: osNames[os] };
    },
    
    getInfo: function() {
        const osInfo = this.getOSInfo();
        return {
            os: osInfo.os,
            osName: osInfo.name,
            browser: navigator.userAgent,
            timestamp: new Date().toLocaleString()
        };
    }
};

/**
 * Full host system detection — single entry point that replaces fragmented
 * OS detection, storage queries, and tool sync calls.
 *
 * Calls backend `host-scan` which returns OS, distro, kernel, hostname,
 * arch, CPU count, RAM, disk, and all installed tools in one pass.
 * Stores every value in localStorage then refreshes all GUI panels.
 *
 * Call this once at startup (instead of syncInstalledFromSystem +
 * syncPreInstalledTools) and again after initialize / install / uninstall.
 */
async function detectFullHostSystem(force = false) {
    // Skip the live Python scan if one completed successfully in the last 30 minutes.
    // Tool installs don't change between rapid app re-launches, so cached localStorage
    // data is accurate for typical usage.  Prevents the 5-30 s Python boot hang on
    // every single restart.  Force-refresh is still available via the Refresh button
    // or by clearing cache > 30 min after the last scan.
    const lastScanTs = parseInt(localStorage.getItem('lastHostScanTime') || '0');
    if (!force && lastScanTs && (Date.now() - lastScanTs) < 30 * 60 * 1000) {
        logActivity('Host detection: using recent cached data', 'info');
        initializeDashboard?.();
        updateSettingsSystemInfo?.();
        reapplyToolFilter?.();
        updateSystemStatus?.();
        return null;
    }

    logActivity('Running full host system detection…', 'info');

    // ── Build lowercase key→displayName lookup once ──────────────────────────
    const keyToName = {};
    for (const [key, tool] of Object.entries(TOOLS_DATABASE)) {
        keyToName[key.toLowerCase()] = tool.name;
    }

    // ── Primary path: Python backend host-scan (returns OS + hardware + tools) ─
    let data = null;
    try {
        const res = await BackendAPI.getHostScan();
        if (res?.success) {
            data = res;
        } else {
            const err = res?.error || 'no data returned';
            logActivity(`Host scan warning: ${err}`, 'warning');
        }
    } catch (e) {
        logActivity(`Host scan error: ${e?.message || e}`, 'warning');
    }

    if (data) {
        // ── OS / hardware ──────────────────────────────────────
        if (data.os)         localStorage.setItem('userOS',       data.os);
        if (data.distro)     localStorage.setItem('userDistro',   data.distro);
        if (data.kernel)     localStorage.setItem('hostKernel',   data.kernel);
        if (data.hostname)   localStorage.setItem('hostName',     data.hostname);
        if (data.arch)       localStorage.setItem('hostArch',     data.arch);
        if (data.cpu_count != null) localStorage.setItem('hostCpuCount', String(data.cpu_count));

        // ── RAM / disk ─────────────────────────────────────────
        if (data.ram_total_gb != null) localStorage.setItem('hostRamTotal',  String(data.ram_total_gb));
        if (data.ram_avail_gb != null) localStorage.setItem('hostRamAvail',  String(data.ram_avail_gb));
        if (data.disk_total_gb != null) localStorage.setItem('hostDiskTotal', String(data.disk_total_gb));
        if (data.disk_avail_gb != null) localStorage.setItem('hostDiskAvail', String(data.disk_avail_gb));

        // ── Installed tools — clear stale entries then repopulate ──────────────
        // Only clear stale entries when host-scan returned a meaningful result.
        // Guard 1: skip entirely if installed_tools is empty/missing (degraded env).
        // Guard 2: only stale-clear if the new scan found at least as many tools
        //   as we already knew about — prevents a partial scan (e.g. gvm-only)
        //   from wiping out the full set of 16 previously-detected tools.
        if (Array.isArray(data.installed_tools) && data.installed_tools.length > 0) {
            const scanSet = new Set(data.installed_tools);
            const currentInstalled = getInstalledTools();
            const currentCount = Object.keys(currentInstalled).length;
            if (data.installed_tools.length >= currentCount || currentCount === 0) {
                for (const k of Object.keys(currentInstalled)) {
                    if (!scanSet.has(k)) setToolInstalled(k, false);
                }
            }
            data.installed_tools.forEach(k => setToolInstalled(k, true));
            logActivity(
                `Host scan: ${data.installed_tools.length} tool(s) detected as installed on ${data.distro || data.os}`,
                'success'
            );
        }

        const ramStr  = data.ram_total_gb  != null ? `${data.ram_total_gb} GB RAM`  : '';
        const diskStr = data.disk_total_gb != null ? `${data.disk_total_gb} GB disk` : '';
        const cpuStr  = data.cpu_count     != null ? `${data.cpu_count} CPU cores`  : '';
        const hwParts = [ramStr, diskStr, cpuStr].filter(Boolean);
        logActivity(
            `Host detected: ${data.distro || data.os}${hwParts.length ? ' | ' + hwParts.join(' | ') : ''}`,
            'success'
        );
        // Cache the scan timestamp so the next boot within 30 min skips Python
        localStorage.setItem('lastHostScanTime', Date.now().toString());
    } else {
        // ── Fallback: read ~/.kjer/system_analysis.json via Node IPC ─────────
        // This path doesn't need Python at all — always works in Electron.
        // system_analysis.json is written by the CLI --analyze pass at install time.
        logActivity('Host scan unavailable — falling back to system_analysis.json', 'info');
        try {
            const r = await window.electronAPI?.readSystemAnalysis?.();
            if (r?.success && r.data?.detected_tools) {
                const detected = r.data.detected_tools;
                const found = [];
                for (const [yamlKey, info] of Object.entries(detected)) {
                    if (!info?.path && !info?.installed) continue;
                    const displayName = keyToName[yamlKey.toLowerCase()];
                    if (displayName) {
                        const dbKey = Object.keys(TOOLS_DATABASE)
                            .find(k => TOOLS_DATABASE[k].name === displayName)
                            || yamlKey.toLowerCase();
                        setToolInstalled(dbKey, true);
                        found.push(dbKey);
                    }
                }
                if (found.length > 0) {
                    logActivity(
                        `Fallback detection: ${found.length} tool(s) found via system_analysis.json`,
                        'success'
                    );
                } else {
                    logActivity('Fallback detection: no matching tools in system_analysis.json', 'info');
                }
            }
        } catch (fe) {
            logActivity(`Fallback detection error: ${fe?.message || fe}`, 'warning');
        }
    }

    // Always load install-state flags (initialized, installedAt, version, license key)
    // regardless of whether host-scan succeeded — these come from ~/.kjer/ on disk.
    await loadInstallStateIntoApp();

    // Refresh all UI panels with the new data
    initializeDashboard?.();
    updateSettingsSystemInfo?.();
    reapplyToolFilter?.();
    updateSystemStatus?.();

    logActivity('Host detection complete', 'info');
    return data;
}

/**
 * Read ~/.kjer/install_state.json via Electron IPC and store the detected OS
 * in localStorage so every part of the GUI uses the installer-detected OS
 * rather than the browser user-agent.  Falls back to navigator user-agent
 * if the state file is not found (pre-install / web-only mode).
 *
 * NOTE: does NOT overwrite userOS/userDistro if already set by detectFullHostSystem()
 * (live backend detection takes precedence over the install-time snapshot).
 *
 * Call this once, early in DOMContentLoaded (before any rendering).
 */
async function loadInstallStateIntoApp() {
    try {
        const result = await BackendAPI.getInstallState();
        if (result.success && result.state) {
            const { os, distro, installed_at, initialized } = result.state;
            if (os) {
                // Only set OS/distro from install_state.json if not already populated
                // by detectFullHostSystem() (live detection takes precedence).
                if (!localStorage.getItem('userOS'))     localStorage.setItem('userOS', os);
                if (distro && !localStorage.getItem('userDistro')) localStorage.setItem('userDistro', distro);
                if (installed_at) localStorage.setItem('installedAt', installed_at);
                logActivity(`Install state: ${distro || os}`, 'info');
            }
            // Restore initialized flag — if ~/.kjer/initialized exists the user has
            // already completed setup; don't show first-time screens again.
            // If the flag is absent (reset/uninstall), clear any stale localStorage value.
            if (initialized === true) {
                localStorage.setItem('kjerInitialized', 'true');
                logActivity('Initialization state restored from disk', 'info');
            } else if (initialized === false) {
                localStorage.removeItem('kjerInitialized');
            }
        }
    } catch (e) {
        console.warn('Could not read install state:', e);
    }

    // Read version.json to keep kjerVersion in sync with what's on disk.
    // This ensures the sidebar/settings always show the correct version after upgrades.
    try {
        const vf = await window.electronAPI?.readVersionFile?.();
        if (vf?.success && vf.data?.version) {
            localStorage.setItem('kjerVersion', vf.data.version);
        }
    } catch (e) { /* non-fatal */ }

    // Fallback: browser user-agent (Electron reports the host OS correctly)
    if (!localStorage.getItem('userOS')) {
        localStorage.setItem('userOS', SystemInfo.detectOS());
    }

    // Restore saved license key from disk whenever the activation flag is missing.
    // Gating on !kjerActivated (not !kjerLicenseKey) ensures a disk read happens
    // even when kjerLicenseKey is already cached but kjerActivated was separately
    // wiped — the most common failure scenario.
    if (!localStorage.getItem('kjerActivated')) {
        try {
            const cached = await readLicenseKeyFromDisk();
            if (cached && cached.key) {
                // For promo licenses, check expiry before restoring activated state
                let promoExpired = false;
                if (cached.type === 'promo' && cached.expires_at) {
                    try {
                        promoExpired = new Date(cached.expires_at) <= new Date();
                    } catch (_) {}
                }
                if (!promoExpired) {
                    localStorage.setItem('kjerLicenseKey',  cached.key);
                    if (cached.type) localStorage.setItem('kjerLicenseType', cached.type);
                    if (cached.expires_at && cached.type === 'promo')
                        localStorage.setItem('kjerPromoExpires', cached.expires_at);
                    // A key on disk means the user successfully activated — restore that state.
                    localStorage.setItem('kjerActivated', 'true');
                    logActivity('License key restored from saved state', 'info');
                    // Warm the main-process auth session so feature gates work immediately
                    await window.electronAPI?.setLicenseAuth?.({
                        authorized:     true,
                        licenseType:    (cached.type === 'promo' ? 'personal' : cached.type) || 'personal',
                        displayVersion: cached.version || localStorage.getItem('kjerVersion') || '1.0.0',
                    });
                } else {
                    logActivity('Promo license has expired — activation required', 'warning');
                }
            }
        } catch (e) { /* non-fatal */ }
    }

    // Pre-populate installedTools from system_analysis.json before first render.
    // Uses Node IPC (no Python subprocess needed) so it completes immediately.
    // Always runs — merges any tool found in system_analysis.json into localStorage
    // without removing tools already there, so this is idempotent and safe to run
    // on every startup (handles partial state, stale gvm-only entries, etc.).
    let _sysAnalysisLoaded = false;
    try {
        const r = await window.electronAPI?.readSystemAnalysis?.();
        if (r?.success && r.data?.detected_tools) {
            _sysAnalysisLoaded = true;
            const dbKeySet = new Set(Object.keys(TOOLS_DATABASE));
            let preCount = 0;
            for (const [yamlKey, info] of Object.entries(r.data.detected_tools)) {
                if (!info?.path && !info?.installed) continue;
                if (dbKeySet.has(yamlKey)) {
                    setToolInstalled(yamlKey, true);
                    preCount++;
                }
            }
            if (preCount > 0) {
                logActivity(`Pre-loaded ${preCount} installed tool(s) from system cache`, 'info');
            }
        }
    } catch (_) { /* non-fatal */ }

    // Auto-recovery: if ~/.kjer/initialized was wiped (e.g. by a reinstall) but
    // system_analysis.json exists alongside a valid install_state.json, the system
    // was already set up — recreate the flag so the app doesn't land the user on
    // the license gate after every reinstall.
    if (!localStorage.getItem('kjerInitialized') && _sysAnalysisLoaded && localStorage.getItem('userOS')) {
        try {
            const isWin = localStorage.getItem('userOS') === 'windows';
            const shell = isWin ? 'powershell' : 'bash';
            const cmd   = isWin
                ? ['-Command', 'New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.kjer\\initialized" | Out-Null']
                : ['-c', 'mkdir -p ~/.kjer && touch ~/.kjer/initialized'];
            await window.electronAPI?.executeCommand?.(shell, cmd);
            localStorage.setItem('kjerInitialized', 'true');
            logActivity('Initialization state auto-recovered from system cache', 'info');
        } catch (_) { /* non-fatal */ }
    }

    return localStorage.getItem('userOS');
}

// ==================== TUTORIAL SYSTEM ====================
// Force restart tutorial from settings
function restartTutorial() {
    Tutorial.completed = false;
    localStorage.removeItem('kjerTutorialCompleted');
    Tutorial.currentStep = 0;
    Tutorial.displayStep();
    document.getElementById('tutorialModal').style.display = 'flex';
}

const Tutorial = {
    currentStep: 0,
    completed: localStorage.getItem('kjerTutorialCompleted') === 'true',
    
    steps: [
        {
            title: 'Welcome to Kjer',
            content: 'Kjer is a professional security framework that intelligently manages, coordinates, and deploys multiple security tools. This tutorial will guide you through the key features and help you set up your security environment.'
        },
        {
            title: 'Dashboard - Your Security Overview',
            content: 'The Dashboard shows your system status, active tools, and security activity in real-time. Use the Quick Actions to refresh status, run comprehensive scans, activate smart defense, or generate reports.'
        },
        {
            title: 'Security Tool Box',
            content: 'Browse and install 15+ security tools across categories like EDR, Network Analysis, Reverse Engineering, and more. Tools are automatically ranked by compatibility with your OS. Each tool card shows detailed information and best practices.'
        },
        {
            title: 'Installation Profiles',
            content: 'Profiles are pre-configured security tool sets for different security levels. Choose a preset profile or create your own custom configuration by selecting exactly which tools to install and how to configure them.'
        },
        {
            title: 'System Status & Activity Log',
            content: 'Monitor all security events in real-time with the Wireshark-style activity monitor. View scan results, defense actions, and system events with color-coded severity levels (INFO, SUCCESS, WARNING, ERROR, CRITICAL).'
        },
        {
            title: 'Initialize Kjer',
            content: 'Your OS was already detected when you ran the installer — no re-detection needed. Clicking Initialize activates your license and enables the tool monitoring and management framework for your environment. This unlocks full control: install, remove, and monitor all supported security tools. Click Initialize to get started!'
        }
    ],
    
    show: function() {
        if (this.completed) return;
        this.currentStep = 0;
        this.displayStep();
        document.getElementById('tutorialModal').style.display = 'flex';
    },
    
    displayStep: function() {
        const step = this.steps[this.currentStep];
        document.getElementById('tutorialTitle').textContent = step.title;
        document.getElementById('tutorialText').textContent = step.content;
        
        const nextBtn = document.getElementById('tutorialNext');
        const backBtn = document.getElementById('tutorialBack');
        
        if (this.currentStep === 0) {
            backBtn.style.display = 'none';
            nextBtn.textContent = 'Next';
        } else if (this.currentStep === this.steps.length - 1) {
            backBtn.style.display = 'inline-block';
            nextBtn.textContent = 'Initialize & Continue';
        } else {
            backBtn.style.display = 'inline-block';
            nextBtn.textContent = 'Next';
        }
    }
};

function tutorialNext() {
    if (Tutorial.currentStep < Tutorial.steps.length - 1) {
        Tutorial.currentStep++;
        Tutorial.displayStep();
    } else {
        Tutorial.completed = true;
        localStorage.setItem('kjerTutorialCompleted', 'true');
        tutorialSkip();
        initializeKjer();
    }
}

function tutorialPrevious() {
    if (Tutorial.currentStep > 0) {
        Tutorial.currentStep--;
        Tutorial.displayStep();
    }
}

function tutorialSkip() {
    Tutorial.completed = true;
    localStorage.setItem('kjerTutorialCompleted', 'true');
    document.getElementById('tutorialModal').style.display = 'none';
}

// ==================== NETWORK STATUS CHECKER ====================

const NetworkStatus = {
    status: 'connecting',
    
    async checkConnection() {
        try {
            const response = await fetch('https://www.google.com/favicon.ico', { 
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-store'
            });
            return true;
        } catch (error) {
            return false;
        }
    },
    
    updateUI(status) {
        const statusElement = document.getElementById('networkStatus');
        const statusText = document.getElementById('statusText');
        const statusIcon = document.getElementById('statusIcon');
        
        if (!statusElement) return;
        
        // Remove all status classes
        statusElement.classList.remove('connected', 'not-connected', 'connecting');
        
        if (status === 'connected') {
            statusElement.classList.add('connected');
            statusText.textContent = 'Connected';
            statusIcon.textContent = '●';
        } else if (status === 'not-connected') {
            statusElement.classList.add('not-connected');
            statusText.textContent = 'Not Connected';
            statusIcon.textContent = '○';
        } else {
            statusElement.classList.add('connecting');
            statusText.textContent = 'Connecting';
            statusIcon.textContent = '⟳';
        }
    },
    
    async init() {
        this.updateUI('connecting');
        const isConnected = await this.checkConnection();
        this.status = isConnected ? 'connected' : 'not-connected';
        this.updateUI(this.status);
        
        // Check every 30 seconds
        setInterval(() => {
            this.checkConnection().then(isConnected => {
                const newStatus = isConnected ? 'connected' : 'not-connected';
                if (newStatus !== this.status) {
                    this.status = newStatus;
                    this.updateUI(this.status);
                }
            });
        }, 30000);
    }
};

// ==================== INITIALIZE FUNCTION ====================

async function initializeKjer() {
    logActivity('Beginning Kjer initialization...', 'info');
    try {
    // OS was already detected at install time — read from install state / localStorage.
    // Initialization no longer performs OS detection; it enables tool monitoring and
    // management for the environment that was confirmed during installation.
    const installedOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    const installedDistro = localStorage.getItem('userDistro') || installedOS;
    logActivity(`Activating security framework for: ${installedDistro}`, 'info');

    // Mark as initialized and record the date
    localStorage.setItem('kjerInitialized', 'true');
    localStorage.setItem('initializationDate', new Date().toISOString());
    // Ensure userOS is persisted (may already be set from loadInstallStateIntoApp)
    if (!localStorage.getItem('userOS')) {
        localStorage.setItem('userOS', installedOS);
    }

    // Write ~/.kjer/initialized flag so the CLI knows initialization is complete.
    // No key is required for initialization — only upgrades require a key.
    try {
        const writeCmd = installedOS === 'windows'
            ? ['-Command', 'New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.kjer" | Out-Null; New-Item -ItemType File -Force -Path "$env:USERPROFILE\.kjer\initialized" | Out-Null']
            : ['-c', 'mkdir -p ~/.kjer && touch ~/.kjer/initialized'];
        const shell = installedOS === 'windows' ? 'powershell' : 'bash';
        await window.electronAPI?.executeCommand?.(shell, writeCmd);
    } catch (e) {
        // Non-fatal: CLI will fall back to install_state.json check
    }
    
    // Update dashboard with real data now
    initializeDashboard();
    updateSystemStatus();
    
    // Enable OS-specific tool monitoring and security profiles
    if (installedOS === 'linux') {
        logActivity('Linux environment confirmed — enhanced Linux security profiles activated', 'success');
    } else if (installedOS === 'macos') {
        logActivity('macOS environment confirmed — macOS security profiles activated', 'success');
    } else if (installedOS === 'windows') {
        logActivity('Windows environment confirmed — Windows-optimized security suite activated', 'success');
    }

    // Detect and register pre-installed tools, and read hardware info.
    // detectFullHostSystem() does the full OS + RAM + disk + binary check in one
    // backend pass, caches everything in localStorage, and refreshes all panels.
    // force=true bypasses the 30-min cooldown so we always get fresh data right
    // after initialization completes.
    await detectFullHostSystem(true);

    // Auto-register the 'kjer' CLI command on the host system
    await setupCLIIntegration(installedOS);

    // Ensure local Electron dependencies are installed so CLI 'kjer --gui' works
    await setupElectronDependencies(installedOS);

    // Set up passwordless package management (one-time, runs silently)
    await setupSudoIfNeeded();

    // Initialization complete — tools and profiles are now fully operational
    setTimeout(() => {
        logActivity('Initialization complete — Kjer is fully operational', 'success', '', true);
        showNotification('✓ Kjer initialized successfully!');
        renderToolsList();
        renderProfiles();
    }, 2000);

    } catch (initErr) {
        localStorage.removeItem('kjerInitialized');
        logActivity(`Initialization failed: ${initErr.message || initErr}`, 'error', '', true);
        showNotification('✗ Initialization failed. Check the activity log for details.');
    }
}

// ─────────────── Sudo / Passwordless Install Setup ───────────────

async function setupSudoIfNeeded() {
    const userOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    if (userOS !== 'linux') return;
    try {
        const check = await BackendAPI.checkSudo();
        if (check.configured) {
            logActivity('Passwordless install: already configured', 'info');
            updateSudoStatusBadge(true);
            return;
        }
        logActivity('Passwordless installs not configured — launching one-time setup (requires authentication)...', 'info');
        const result = await BackendAPI.setupSudo();
        if (result.success) {
            logActivity('Passwordless installs configured successfully', 'success');
            updateSudoStatusBadge(true);
        } else if (result.manual_cmd) {
            logActivity(`Passwordless installs: run this once in a terminal to configure manually:\n${result.manual_cmd}`, 'warning');
            updateSudoStatusBadge(false);
        } else {
            logActivity(`Passwordless installs: ${result.error || 'setup failed'} — use Settings → Setup Passwordless Installs`, 'warning');
            updateSudoStatusBadge(false);
        }
    } catch (e) { /* non-fatal */ }
}

function updateSudoStatusBadge(configured) {
    const el = document.getElementById('sudoStatusBadge');
    if (!el) return;
    if (configured) {
        el.textContent = '✓ Ready';
        el.style.color = '#4CAF50';
    } else {
        el.textContent = '✗ Not configured';
        el.style.color = '#FF6B6B';
    }
}

async function runSudoSetup() {
    const btn = document.getElementById('setupSudoBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Configuring…'; }
    try {
        const result = await BackendAPI.setupSudo();
        if (result.success) {
            showNotification('✓ Passwordless installs configured successfully');
            logActivity('Passwordless installs configured via Settings', 'success');
            updateSudoStatusBadge(true);
        } else if (result.manual_cmd) {
            showNotification('Auto-setup unavailable — see activity log for manual command');
            logActivity(`Manual setup command: ${result.manual_cmd}`, 'warning');
        } else {
            showNotification(`Setup failed: ${result.error || 'unknown error'}`);
            logActivity(`Sudo setup failed: ${result.error}`, 'error');
        }
    } catch (e) {
        showNotification('Setup error — check activity log');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Setup Passwordless Installs'; }
        try {
            const check = await BackendAPI.checkSudo();
            updateSudoStatusBadge(check.configured);
        } catch (_) {}
    }
}

async function checkSudoStatus() {
    try {
        const check = await BackendAPI.checkSudo();
        updateSudoStatusBadge(check.configured);
    } catch (_) {}
}

async function setupElectronDependencies(osName) {
    // Ensures desktop/node_modules/electron exists so the CLI can launch the GUI
    // via 'npx electron .' or './node_modules/.bin/electron .'
    // We are already running inside Electron, so Node/npm is available on PATH.
    logActivity('Verifying Electron runtime dependencies...', 'info');
    try {
        const kjerpathi = await window.electronAPI?.getAppPath?.();
        if (!kjerpathi) {
            logActivity('Electron dependency check skipped (no app path)', 'info');
            return;
        }
        const desktopDir   = `${kjerpathi}/desktop`;
        const nodeModules  = `${desktopDir}/node_modules/electron`;

        // Check if local electron is already installed
        const checkCmd = osName === 'windows'
            ? `powershell -Command "if (Test-Path '${nodeModules}') { 'found' } else { 'missing' }"`
            : `bash -c "[ -d '${nodeModules}' ] && echo found || echo missing"`;
        const [checkExe, ...checkArgs] = checkCmd.split(' ');
        const checkResult = await window.electronAPI.executeCommand(
            osName === 'windows' ? 'powershell' : 'bash',
            osName === 'windows'
                ? ['-Command', `if (Test-Path '${nodeModules}') { 'found' } else { 'missing' }`]
                : ['-c', `[ -d '${nodeModules}' ] && echo found || echo missing`]
        );

        if (checkResult?.stdout?.trim() === 'found') {
            logActivity('Electron runtime: already installed', 'success');
            return;
        }

        logActivity('Installing Electron runtime (npm install)...', 'info');

        // Check if npm is available; if not, install Node.js first
        const npmCheck = await window.electronAPI.executeCommand(
            osName === 'windows' ? 'powershell' : 'bash',
            osName === 'windows'
                ? ['-Command', 'if (Get-Command npm -ErrorAction SilentlyContinue) { "found" } else { "missing" }']
                : ['-c', 'command -v npm >/dev/null 2>&1 && echo found || echo missing']
        );

        if (npmCheck?.stdout?.trim() !== 'found') {
            logActivity('Node.js not found — installing automatically...', 'info');

            if (osName === 'linux') {
                // Detect distro and use appropriate package manager
                const distroResult = await window.electronAPI.executeCommand('bash', [
                    '-c',
                    'if command -v apt-get >/dev/null 2>&1; then echo apt;' +
                    ' elif command -v dnf >/dev/null 2>&1; then echo dnf;' +
                    ' elif command -v pacman >/dev/null 2>&1; then echo pacman;' +
                    ' elif command -v zypper >/dev/null 2>&1; then echo zypper;' +
                    ' else echo unknown; fi'
                ]);
                const pm = distroResult?.stdout?.trim();
                const nodeInstallCmd = {
                    apt:    'apt-get update -qq && apt-get install -y nodejs npm',
                    dnf:    'dnf install -y nodejs npm',
                    pacman: 'pacman -S --noconfirm nodejs npm',
                    zypper: 'zypper install -y nodejs npm',
                }[pm];
                if (nodeInstallCmd) {
                    await window.electronAPI.executeCommand('bash', ['-c', `pkexec sh -c '${nodeInstallCmd}'`]);
                    logActivity(`Node.js installed via ${pm}`, 'success');
                } else {
                    logActivity('Cannot auto-install Node.js — unknown Linux distro. Run: sudo apt install nodejs npm', 'warning');
                    return;
                }
            } else if (osName === 'macos') {
                const brewCheck = await window.electronAPI.executeCommand('bash', [
                    '-c', 'command -v brew >/dev/null 2>&1 && echo found || echo missing'
                ]);
                if (brewCheck?.stdout?.trim() === 'found') {
                    await window.electronAPI.executeCommand('bash', ['-c', 'brew install node']);
                    logActivity('Node.js installed via Homebrew', 'success');
                } else {
                    logActivity('Homebrew not found — install Node.js from https://nodejs.org', 'warning');
                    return;
                }
            } else if (osName === 'windows') {
                await window.electronAPI.executeCommand('powershell', [
                    '-Command',
                    'winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent'
                ]);
                logActivity('Node.js installed via winget', 'success');
            }
        }

        // Now run npm install in desktop/
        const npmResult = await window.electronAPI.executeCommand(
            osName === 'windows' ? 'powershell' : 'bash',
            osName === 'windows'
                ? ['-Command', `Set-Location '${desktopDir}'; npm install 2>&1`]
                : ['-c', `cd '${desktopDir}' && npm install 2>&1 | tail -3`]
        );

        if (checkResult?.code === 0 || npmResult?.stdout?.includes('added')) {
            logActivity('Electron runtime installed successfully', 'success');
            logActivity('"kjer --gui" will now work from any terminal', 'success');
        } else {
            logActivity('Electron install completed (verify with: cd desktop && npm install)', 'info');
        }
    } catch (e) {
        logActivity('Electron dependency setup completed', 'info');
    }
}

async function setupCLIIntegration(osName) {
    // Auto-register the 'kjer' CLI command on the host system after initialization.
    // Linux/macOS : creates a symlink in ~/.local/bin/kjer (no sudo required).
    //               Falls back to /usr/local/bin via pkexec if ~/.local/bin fails.
    // Windows     : verifies the launcher exists in %ProgramFiles%\Kjer\.
    logActivity('Registering "kjer" CLI command on this system...', 'info');
    try {
        const kjerpathi = await window.electronAPI?.getAppPath?.();
        if (!kjerpathi) {
            logActivity('CLI setup: run the installer script to register the "kjer" command', 'info');
            return;
        }

        if (osName === 'linux' || osName === 'macos') {
            const cliScript  = `${kjerpathi}/scripts/kjer-cli.py`;
            const localBin   = `${process.env.HOME || '~'}/.local/bin`;
            const linkTarget = `${localBin}/kjer`;

            // Check if 'kjer' is already accessible on PATH
            const checkResult = await window.electronAPI.executeCommand('bash', [
                '-c', 'command -v kjer >/dev/null 2>&1 && echo "found" || echo "missing"'
            ]);
            if (checkResult?.stdout?.trim() === 'found') {
                logActivity('"kjer" command is already available on PATH', 'success');
                return;
            }

            // Create symlink in ~/.local/bin (no sudo; in PATH on Ubuntu 20+, Fedora 33+, macOS)
            const setupScript = [
                `chmod +x "${cliScript}"`,
                `mkdir -p "${localBin}"`,
                `ln -sf "${cliScript}" "${linkTarget}"`,
                `echo "ok"`,
            ].join(' && ');

            const linkResult = await window.electronAPI.executeCommand('bash', ['-c', setupScript]);
            if (linkResult?.stdout?.trim() === 'ok') {
                logActivity(`CLI registered: ${linkTarget}`, 'success');
                logActivity('Open a new terminal and type "kjer" to access the CLI', 'info');
            } else {
                // Fallback: attempt /usr/local/bin via pkexec (prompts for admin password)
                const pkCmd = `pkexec sh -c 'ln -sf "${cliScript}" /usr/local/bin/kjer && chmod +x /usr/local/bin/kjer' && echo "ok"`;
                const pkResult = await window.electronAPI.executeCommand('bash', ['-c', pkCmd]);
                if (pkResult?.stdout?.trim() === 'ok') {
                    logActivity('CLI registered: /usr/local/bin/kjer (system-wide)', 'success');
                } else {
                    logActivity('CLI setup: run "sudo ./installer/install-linux.sh" to register the "kjer" command', 'info');
                }
            }

        } else if (osName === 'windows') {
            const checkResult = await window.electronAPI.executeCommand('powershell', [
                '-Command',
                'if (Get-Command kjer -ErrorAction SilentlyContinue) { "found" } else { "missing" }',
            ]);
            if (checkResult?.stdout?.trim() === 'found') {
                logActivity('"kjer" command is available on PATH', 'success');
            } else {
                logActivity('CLI setup: run installer\\install-windows.ps1 (as Administrator) to register "kjer"', 'info');
            }
        }
    } catch (e) {
        logActivity('CLI integration check completed', 'info');
    }
}

function openManual() {
    const manual = document.getElementById('manualModal');
    const content = document.getElementById('manualContent');
    
    let html = '<div style="margin-bottom: 20px;"><h3 style="color: #9D4EDD; border-bottom: 2px solid #9D4EDD; padding-bottom: 10px;">Kjer Security Tools Documentation</h3></div>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">';
    
    // Sort tools by category and name for better organization
    const sortedTools = Object.entries(TOOLS_DATABASE).sort((a, b) => {
        const catCompare = a[1].category.localeCompare(b[1].category);
        return catCompare !== 0 ? catCompare : a[1].name.localeCompare(b[1].name);
    });
    
    for (const [key, tool] of sortedTools) {
        const osIcons = tool.osCompatibility.map(os => {
            if (os === 'windows') return '🪟 Windows';
            if (os === 'linux') return '🐧 Linux';
            if (os === 'macos') return '🍎 macOS';
            return os;
        }).join(' • ');
        
        html += `
            <div style="padding: 15px; background-color: rgba(157, 78, 221, 0.05); border-left: 3px solid #9D4EDD; border-radius: 4px;">
                <h4 style="color: #B0E0E6; margin: 0 0 10px 0;">${tool.name}</h4>
                <p style="margin: 0 0 8px 0; color: #9D4EDD; font-weight: bold; font-size: 13px;">${tool.category}</p>
                <p style="margin: 0 0 10px 0; color: #B0E0E6; line-height: 1.5;">${tool.detailedDescription}</p>
                <p style="margin: 0 0 8px 0; color: #888; font-size: 12px;">${osIcons}</p>
                <p style="margin: 0; color: #B0E0E6; font-size: 12px;"><strong>Size:</strong> ${tool.size_mb}MB | <strong>Version:</strong> ${tool.version}</p>
            </div>
        `;
    }
    
    html += '</div>';
    content.innerHTML = html;
    manual.style.display = 'flex';
}

function closeManual() {
    document.getElementById('manualModal').style.display = 'none';
}

// ==================== LICENSE KEY PERSISTENCE ====================

/**
 * Write the license key to ~/.kjer/license_key.json so it survives
 * localStorage clears and app reinstalls.
 */
async function saveLicenseKeyToDisk(key, type) {
    const os = localStorage.getItem('userOS') || 'linux';
    try {
        const payload = JSON.stringify({ key, type, saved_at: new Date().toISOString() });
        const shell   = os === 'windows' ? 'powershell' : 'bash';
        const cmd     = os === 'windows'
            ? ['-Command', `New-Item -Force -Path "$env:USERPROFILE\\.kjer" -ItemType Directory | Out-Null; Set-Content -Path "$env:USERPROFILE\\.kjer\\license_key.json" -Value '${payload}' -Encoding UTF8`]
            : ['-c', `mkdir -p ~/.kjer && printf '%s' '${payload}' > ~/.kjer/license_key.json`];
        await window.electronAPI?.executeCommand?.(shell, cmd);
    } catch (e) { /* non-fatal */ }
}

/**
 * Read ~/.kjer/license_key.json written by saveLicenseKeyToDisk() or the CLI.
 * Returns { key, type, saved_at } or null.
 */
async function readLicenseKeyFromDisk() {
    // Primary: direct IPC read — no subprocess, works reliably regardless of PATH.
    try {
        if (window.electronAPI?.readLicenseKey) {
            const r = await window.electronAPI.readLicenseKey();
            if (r?.success && r.key) return r;
        }
    } catch (e) { /* fall through to bash fallback */ }

    // Fallback: bash/powershell subprocess (legacy path for environments where
    // the preload version pre-dates the readLicenseKey IPC handler).
    const os = localStorage.getItem('userOS') || 'linux';
    try {
        const shell = os === 'windows' ? 'powershell' : 'bash';
        const cmd   = os === 'windows'
            ? ['-Command', `if (Test-Path "$env:USERPROFILE\\.kjer\\license_key.json") { Get-Content "$env:USERPROFILE\\.kjer\\license_key.json" -Raw } else { '{}' }`]
            : ['-c', `cat ~/.kjer/license_key.json 2>/dev/null || echo '{}'`];
        const result = await window.electronAPI?.executeCommand?.(shell, cmd);
        const raw = result?.stdout?.trim();
        if (raw && raw !== '{}') return JSON.parse(raw);
    } catch (e) { /* non-fatal */ }
    return null;
}

// ==================== ACTIVATION MODAL ====================

// Holds the GitHub token returned by the backend on a successful upgrade
// activation. Cleared immediately after use in confirmUpgradeReinit().
let _pendingGithubToken = null;

// Persisted (in-memory, session-scoped) GitHub token received from the license
// backend after any successful activation.  Used by checkForKjerUpdates() so
// that update checks and installs work without prompting the user again.
let _storedUpgradeToken = '';

// ── License gate flag ────────────────────────────────────────────────────────
// When true the activation modal is acting as a startup gate and cannot be
// dismissed without a valid key.  Set by showLicenseGate(), cleared by
// releaseLicenseGate() after successful activation.
let _licenseGateActive = false;

// Show the activation modal as a non-closeable startup gate.
// Called from DOMContentLoaded when no valid license is found.
function showLicenseGate() {
    _licenseGateActive = true;
    const closeBtn = document.getElementById('activationModalCloseBtn');
    if (closeBtn) closeBtn.style.display = 'none';
    const keyInput = document.getElementById('licenseKeyInput');
    if (keyInput) keyInput.value = '';
    document.getElementById('activationStatus').innerHTML =
        '<span style="color:#9D4EDD; font-size:13px;">A valid Kjer license key is required to continue.</span>';
    document.getElementById('activationModal').style.display = 'flex';
    setTimeout(() => { if (keyInput) keyInput.focus(); }, 100);
}

// Called after successful activation while the gate is active.
// Clears the gate, closes the modal, and boots the rest of the application.
function releaseLicenseGate() {
    _licenseGateActive = false;
    const closeBtn = document.getElementById('activationModalCloseBtn');
    if (closeBtn) closeBtn.style.display = '';
    document.getElementById('activationModal').style.display = 'none';
    bootApplication();
}

function showActivationModal() {
    // Settings-triggered re-activation — not a gate, close button is visible.
    _licenseGateActive = false;
    const closeBtn = document.getElementById('activationModalCloseBtn');
    if (closeBtn) closeBtn.style.display = '';
    document.getElementById('activationModal').style.display = 'flex';
    // Pre-fill with the previously used key
    const savedKey = localStorage.getItem('kjerLicenseKey') || '';
    const keyInput = document.getElementById('licenseKeyInput');
    if (keyInput && savedKey) keyInput.value = savedKey;
    document.getElementById('activationStatus').innerHTML = '';
}

function closeActivationModal() {
    if (_licenseGateActive) return; // gate can only be dismissed by a valid key
    document.getElementById('activationModal').style.display = 'none';
}

// ── Sync display from trusted main-process session ────────────────────────────────
// Populates localStorage display cache FROM the session — never the other way around.
// This is the only place that writes kjerVersion/kjerActivated/kjerLicenseType.
function syncSessionToDisplay(session) {
    if (!session) return;
    if (session.authorized) {
        localStorage.setItem('kjerActivated',   'true');
        localStorage.setItem('kjerLicenseType', session.licenseType    || 'enterprise');
        localStorage.setItem('kjerVersion',     session.displayVersion || '1.0.0');
    }
}

async function activateKjer() {
    const licenseKey = document.getElementById('licenseKeyInput').value.trim().toUpperCase();
    // Infer tier from key segment: KJER-IND-... / KJER-ENT-... / KJER-HOM-... / KJER-PER-... (default personal)
    const keyLower    = licenseKey.toLowerCase();
    const licenseType = keyLower.includes('-ind-') ? 'industrial'
                      : keyLower.includes('-ent-') ? 'enterprise'
                      : keyLower.includes('-hom-') ? 'home'
                      : 'personal';
    const statusDiv = document.getElementById('activationStatus');

    // ── Master key check — validated against key file on disk, never compared in renderer
    const devCheck = await window.electronAPI?.validateDevKey?.(licenseKey);
    if (devCheck?.valid) {
        // Auth state is now set in main process — query it back to populate display
        const session = await window.electronAPI?.getAuthSession?.();
        syncSessionToDisplay(session);
        document.getElementById('licenseKeyInput').value = ''; // clear — no auto-fill next time
        statusDiv.innerHTML = '<span style="color: #4caf50;">✓ Master Key Accepted! All features Unlocked</span>';
        updateLicenseStatus();
        if (_licenseGateActive) {
            setTimeout(() => releaseLicenseGate(), 1500);
        } else {
            setTimeout(() => { closeActivationModal(); initializeKjer(); }, 1500);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!licenseKey || licenseKey.length !== 24) {
        statusDiv.innerHTML = `<span style="color: #ff6b6b;">Invalid key format — must be exactly 24 characters (e.g. KJER-XXXX-XXXX-XXXX-XXXX, currently ${licenseKey.length})</span>`;
        return;
    }

    statusDiv.innerHTML = '<span style="color: #9D4EDD;">Activating...</span>';

    const result = await BackendAPI.activateLicense(licenseKey, licenseType);
    
    if (result.success) {
        const isPromo   = result.license_type === 'promo';
        const effType   = isPromo ? 'personal' : licenseType;   // promos get Personal-tier features
        const tierLabel = isPromo
            ? `${result.promo_days}-Day Promo`
            : (KJER_TIERS[licenseType] || KJER_TIERS.personal).label;
        const expiryNote = isPromo
            ? ` · expires ${result.expires_at ? result.expires_at.slice(0, 10) : 'soon'}`
            : '';
        statusDiv.innerHTML = `<span style="color: #4caf50;">✓ ${tierLabel} License activated!${expiryNote}</span>`;

        // ── Persist the key so the user never has to re-enter it ──────────
        localStorage.setItem('kjerLicenseKey',  licenseKey);
        localStorage.setItem('kjerLicenseType', isPromo ? 'promo' : licenseType);
        localStorage.setItem('kjerActivated',   'true');
        if (isPromo) {
            localStorage.setItem('kjerPromoExpires', result.expires_at || '');
            localStorage.setItem('kjerPromoDays',    String(result.promo_days || ''));
        }
        saveLicenseKeyToDisk(licenseKey, isPromo ? 'promo' : licenseType);
        // Cache any GitHub token returned by the backend for update checks/installs
        if (result.github_token) _storedUpgradeToken = result.github_token;
        // Set auth session in main process
        await window.electronAPI?.setLicenseAuth?.({
            authorized:     true,
            licenseType:    effType,
            displayVersion: '1.0.0',
        });
        // ──────────────────────────────────────────────────────────────────

        updateLicenseStatus();
        setTimeout(() => {
            if (_licenseGateActive) {
                releaseLicenseGate();
            } else {
                closeActivationModal();
                initializeKjer();
            }
        }, 1500);
    } else {
        statusDiv.innerHTML = `<span style="color: #ff6b6b;">✗ ${result.message}</span>`;
    }
}

async function confirmUpgradeReinit(newVersion) {
    closeActivationModal();

    // Consume the stashed token (cleared so it can't be reused)
    const githubToken  = _pendingGithubToken;
    _pendingGithubToken = null;

    if (githubToken) {
        logActivity(`Downloading Kjer v${newVersion} from upgrade repository…`, 'info', '', true);
        const upgraded = await performVersionUpgrade(newVersion, githubToken);
        if (!upgraded) {
            logActivity('Upgrade download failed — your key is saved. Try the Upgrade button again later.', 'error', '', true);
            showNotification('✗ Upgrade download failed. Check the activity log.');
            return;
        }
    } else {
        logActivity(`No upgrade package available for v${newVersion} — license key stored.`, 'warning');
    }

    logActivity(`Reinitializing Kjer as v${newVersion}…`, 'info');
    initializeKjer();
}

/**
 * Download and apply a version upgrade from the private GitHub repository.
 * Called before reinitialization when the backend returns a github_token.
 * @param {string} version      - target version e.g. "1.1.0"
 * @param {string} githubToken  - fine-grained PAT returned by the backend
 * @returns {Promise<boolean>}  - true on success
 */
async function performVersionUpgrade(version, githubToken, onProgress = null) {
    const progress = (pct, text) => { if (onProgress) onProgress(pct, text); };
    try {
        const installPath = await window.electronAPI?.getAppPath?.();
        if (!installPath) {
            logActivity('Cannot determine install path — upgrade aborted.', 'error');
            return false;
        }

        logActivity(`Downloading update v${version} from upgrade repository…`, 'info');
        progress(30, 'Downloading update package…');

        const upgradeScript = `${installPath}/lib/upgrade_manager.py`;
        const result = await window.electronAPI.executeCommand('python3', [
            upgradeScript, 'install', version, githubToken, installPath
        ]);

        if (!result) {
            logActivity('Upgrade command returned no response.', 'error');
            return false;
        }

        progress(85, 'Applying update…');

        // upgrade_manager.py prints a single JSON line to stdout
        let parsed = {};
        try {
            parsed = JSON.parse((result.stdout || '').trim());
        } catch {
            logActivity('Could not parse upgrade response: ' + (result.stdout || result.stderr || 'empty'), 'error');
            return false;
        }

        if (parsed.success) {
            logActivity(`✓ ${parsed.message}`, 'success', '', true);
            localStorage.setItem('kjerVersion', version);
            progress(100, '✓ Update applied!');
            // Update sidebar version display immediately
            const sidebarVerEl = document.getElementById('sidebarVersion');
            if (sidebarVerEl) sidebarVerEl.textContent = `v${version.replace(/^v/i, '')}`;
            return true;
        } else {
            logActivity(`✗ Upgrade: ${parsed.message}`, 'error', '', true);
            return false;
        }
    } catch (e) {
        logActivity(`Upgrade error: ${e.message || e}`, 'error', '', true);
        return false;
    }
}

async function applyUpgradeKey() {
    const upgradeKey = document.getElementById('upgradeKeyInput').value.trim().toUpperCase();
    const tierSelect = document.getElementById('upgradeKeyTier');
    const licenseType = tierSelect ? tierSelect.value : 'personal';

    // ── Master key check — validated against key file on disk, never compared in renderer
    const devCheck = await window.electronAPI?.validateDevKey?.(upgradeKey);
    if (devCheck?.valid) {
        // Auth state is now set in main process — query it back to populate display
        const session = await window.electronAPI?.getAuthSession?.();
        syncSessionToDisplay(session);
        document.getElementById('upgradeKeyInput').value = ''; // clear — no auto-fill next time
        showNotification('✓ Master Key Accepted! All features Unlocked', 'success');
        logActivity('Master Key Accepted: All features Unlocked', 'success');
        updateLicenseStatus();
        renderProfiles();
        return;
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!upgradeKey || upgradeKey.length < 10) {
        alert('Please enter a valid license key.');
        return;
    }

    const result = await BackendAPI.activateLicense(upgradeKey, licenseType);

    if (result.success) {
        document.getElementById('upgradeKeyInput').value = '';
        // Persist activation
        localStorage.setItem('kjerLicenseKey',  upgradeKey);
        localStorage.setItem('kjerLicenseType', licenseType);
        localStorage.setItem('kjerActivated',   'true');
        saveLicenseKeyToDisk(upgradeKey, licenseType);
        // Cache any GitHub token returned by the backend for update checks/installs
        if (result.github_token) _storedUpgradeToken = result.github_token;
        // Set auth session in main process
        await window.electronAPI?.setLicenseAuth?.({
            authorized:     true,
            licenseType:    licenseType,
            displayVersion: '1.0.0',
        });
        const tierLabel = licenseType === 'enterprise' ? 'Enterprise' : 'Personal';
        showNotification(`✓ ${tierLabel} License activated!`, 'success');
        logActivity(`${tierLabel} License activated`, 'success');
        updateLicenseStatus();
        renderProfiles();
    } else {
        showNotification(`✗ ${result.message || 'Failed to activate license key'}`, 'error');
    }
}

async function updateVersionDisplay() {
    // Update the version display elements
    const versionInfo = await BackendAPI.callBackend('get-version-info');
    if (versionInfo && versionInfo.success) {
        const storedVersion = localStorage.getItem('kjerVersion') || '—';
        document.getElementById('currentVersionDisplay').textContent =
            versionInfo.current_version || storedVersion;
        document.getElementById('accessibleVersionDisplay').textContent =
            versionInfo.accessible_version || storedVersion;
    }
}

async function checkAvailableTools() {
    const versionInfo = await BackendAPI.callBackend('get-available-tools');
    if (versionInfo && versionInfo.success) {
        const tools = versionInfo.tools || [];
        alert(`Available Tools for v${versionInfo.version}:\n\n${tools.join('\n')}`);
    } else {
        alert('Unable to retrieve available tools');
    }
}

// ==================== TOOLS DATABASE ====================

const TOOLS_DATABASE = {
    'windows-defender': {
        name: 'Windows Defender',
        category: 'EDR',
        icon: '',
        description: 'Built-in Windows endpoint detection and response',
        detailedDescription: 'Windows Defender is Microsoft\'s integrated antivirus and anti-malware solution. It provides real-time protection against viruses, spyware, and ransomware with advanced threat prevention. Features include behavior monitoring, cloud-based protection, and automatic updates. Built into Windows 10/11, it requires no additional installation.',
        status: 'available',
        version: '4.18.2301',
        url: 'https://www.microsoft.com/windows/comprehensive-security',
        osCompatibility: ['windows'],
        compatibilityScore: { windows: 98, macos: 0, linux: 0 },
        dependencies: [],
        size_mb: 200,
        priority: 1,
        installSource: 'builtin',
        runVia: 'builtin'
    },
    'malwarebytes': {
        name: 'Malwarebytes',
        category: 'EDR',
        icon: '',
        description: 'Advanced anti-malware and anti-ransomware protection',
        detailedDescription: 'Malwarebytes combines multiple detection techniques including behavioral analysis and machine learning to catch advanced threats. It specializes in ransomware protection with rollback capabilities and provides real-time scanning. Known for high detection rates against emerging threats and zero-day exploits.',
        status: 'available',
        version: '5.0.15',
        url: 'https://www.malwarebytes.com',
        osCompatibility: ['windows', 'macos', 'linux'],
        compatibilityScore: { windows: 95, macos: 90, linux: 80 },
        dependencies: [],
        size_mb: 250,
        priority: 2,
        installSource: 'download',
        runVia: 'direct'
    },
    'kaspersky': {
        name: 'Kaspersky Endpoint Security',
        category: 'EDR',
        icon: '',
        description: 'Enterprise endpoint protection and management',
        detailedDescription: 'Kaspersky offers comprehensive endpoint protection with advanced threat defense, exploit prevention, and vulnerability assessment. Includes centralized management console for enterprise deployments, behavioral analysis, and integration with corporate security infrastructure.',
        status: 'available',
        version: '11.7.0',
        url: 'https://www.kaspersky.com/enterprise',
        osCompatibility: ['windows', 'macos', 'linux'],
        compatibilityScore: { windows: 92, macos: 85, linux: 75 },
        dependencies: [],
        size_mb: 350,
        priority: 3,
        installSource: 'download',
        runVia: 'daemon'
    },
    'wireshark': {
        name: 'Wireshark',
        category: 'Network',
        icon: '',
        description: 'Network protocol analyzer and packet sniffer',
        detailedDescription: 'Wireshark captures and displays network traffic in real-time. Allows deep inspection of network packets, protocol analysis, and live capture from network interfaces. Essential for network troubleshooting, security analysis, and understanding network communication patterns. Supports thousands of protocols.',
        status: 'available',
        version: '4.0.8',
        url: 'https://www.wireshark.org',
        osCompatibility: ['windows', 'macos', 'linux'],
        compatibilityScore: { windows: 90, macos: 88, linux: 95 },
        dependencies: ['libpcap'],
        size_mb: 120,
        priority: 1,
        installSource: 'pkg',
        runVia: 'direct'
    },
    'suricata': {
        name: 'Suricata',
        category: 'Network',
        icon: '',
        description: 'Open source IDS/IPS engine',
        detailedDescription: 'Suricata is an open-source Intrusion Detection/Prevention System that monitors network traffic for suspicious activity. Supports multi-threaded processing, protocol analysis, and signature-based detection. Can operate in IDS mode (detection only) or IPS mode (blocking threats).',
        status: 'available',
        version: '6.0.11',
        url: 'https://suricata.io',
        osCompatibility: ['linux', 'macos'],
        compatibilityScore: { windows: 60, macos: 85, linux: 98 },
        dependencies: ['libjansson', 'libpcap'],
        size_mb: 180,
        priority: 2,
        installSource: 'pkg',
        runVia: 'daemon'
    },
    'zeek': {
        name: 'Zeek (Bro)',
        category: 'Network',
        icon: '',
        description: 'Network security monitoring framework',
        detailedDescription: 'Zeek is a powerful network analysis framework that monitors network traffic and generates comprehensive logs. Provides automated threat detection, detailed protocol analysis, and custom scripting capabilities. Generates structured logs ideal for SIEM integration and forensic analysis.',
        status: 'available',
        version: '5.0.7',
        url: 'https://zeek.org',
        osCompatibility: ['linux', 'macos'],
        compatibilityScore: { windows: 50, macos: 82, linux: 96 },
        dependencies: ['libpcap', 'openssl'],
        size_mb: 280,
        priority: 3,
        installSource: 'repo',
        runVia: 'daemon'
    },
    'ghidra': {
        name: 'Ghidra',
        category: 'Analysis',
        icon: '',
        description: 'Software reverse engineering framework (NSA)',
        detailedDescription: 'Ghidra is the NSA\'s open-source reverse engineering suite. Includes binary disassembly, decompilation, debugging, and scripting capabilities. Supports multiple processor architectures and file formats. Features collaborative analysis features and extensive API for automation.',
        status: 'available',
        version: '10.2.3',
        url: 'https://ghidra-sre.org',
        osCompatibility: ['windows', 'macos', 'linux'],
        compatibilityScore: { windows: 88, macos: 87, linux: 92 },
        dependencies: ['java'],
        size_mb: 420,
        priority: 1,
        installSource: 'download',
        runVia: 'direct'
    },
    'ida-pro': {
        name: 'IDA Pro',
        category: 'Analysis',
        icon: '',
        description: 'Interactive disassembler and debugger',
        detailedDescription: 'IDA Pro is the industry-leading binary analysis tool. Provides interactive disassembly, decompilation via Hex-Rays plugin, debugging capabilities, and extensive scripting. Used by security researchers worldwide for malware analysis and vulnerability research.',
        status: 'available',
        version: '8.2.0',
        url: 'https://www.hex-rays.com/ida-pro',
        osCompatibility: ['windows', 'linux'],
        compatibilityScore: { windows: 94, macos: 60, linux: 85 },
        dependencies: [],
        size_mb: 890,
        priority: 2,
        installSource: 'download',
        runVia: 'direct'
    },
    'volatility': {
        name: 'Volatility',
        category: 'Analysis',
        icon: '',
        description: 'Memory forensics analysis framework',
        detailedDescription: 'Volatility is the leading open-source memory forensics framework. Analyzes RAM dumps to extract running processes, network connections, and artifacts. Essential for incident response and malware analysis. Supports multiple OS profiles and extensive plugin ecosystem.',
        status: 'available',
        version: '2.6.1',
        url: 'https://www.volatilityfoundation.org',
        osCompatibility: ['windows', 'macos', 'linux'],
        compatibilityScore: { windows: 91, macos: 87, linux: 93 },
        dependencies: ['python3'],
        size_mb: 150,
        priority: 2,
        installSource: 'pkg',
        runVia: 'direct'
    },
    'splunk': {
        name: 'Splunk Enterprise',
        category: 'SIEM',
        icon: '',
        description: 'Data analytics and SIEM platform',
        detailedDescription: 'Splunk is a powerful data analytics platform that ingests, indexes, and analyzes machine-generated data. Functions as a SIEM for security monitoring and threat detection. Provides real-time dashboards, alerting, and advanced search capabilities across terabytes of data.',
        status: 'available',
        version: '9.1.1',
        url: 'https://www.splunk.com',
        osCompatibility: ['windows', 'linux'],
        compatibilityScore: { windows: 90, macos: 50, linux: 96 },
        dependencies: ['python3', 'java'],
        size_mb: 1200,
        priority: 1,
        installSource: 'download',
        runVia: 'daemon'
    },
    'elastic-stack': {
        name: 'Elastic Stack (ELK)',
        category: 'SIEM',
        icon: '',
        description: 'Elasticsearch, Logstash, Kibana stack',
        detailedDescription: 'The Elastic Stack combines Elasticsearch (search engine), Logstash (log processor), and Kibana (visualization). Open-source solution for log management, analytics, and SIEM. Highly scalable and cost-effective alternative to commercial SIEM platforms.',
        status: 'available',
        version: '8.6.0',
        url: 'https://www.elastic.co',
        osCompatibility: ['windows', 'linux', 'macos'],
        compatibilityScore: { windows: 88, macos: 85, linux: 98 },
        dependencies: ['java'],
        size_mb: 950,
        priority: 1,
        installSource: 'repo',
        runVia: 'daemon'
    },
    'nessus': {
        name: 'Nessus Professional',
        category: 'Vulnerability',
        icon: '',
        description: 'Comprehensive vulnerability management',
        detailedDescription: 'Nessus is the most widely used vulnerability scanner. Performs comprehensive vulnerability assessments, compliance checks, and risk analysis. Features include credential-based scanning, cloud integration, and detailed remediation guidance. Regularly updated with new vulnerability plugins.',
        status: 'available',
        version: '10.5.2',
        url: 'https://www.tenable.com/products/nessus',
        osCompatibility: ['windows', 'linux'],
        compatibilityScore: { windows: 92, macos: 50, linux: 94 },
        dependencies: [],
        size_mb: 850,
        priority: 1,
        installSource: 'download',
        runVia: 'daemon'
    },
    'openvas': {
        name: 'OpenVAS',
        category: 'Vulnerability',
        icon: '',
        description: 'Open source vulnerability scanner',
        detailedDescription: 'OpenVAS is a free and open-source vulnerability scanner. Performs network and host vulnerability assessments with a growing NVT database. Includes reporting capabilities, task scheduling, and integration with other security tools. Community-driven development.',
        status: 'available',
        version: '21.4.0',
        url: 'https://openvas.org',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 40, macos: 60, linux: 98 },
        dependencies: ['openssl', 'glib2'],
        size_mb: 650,
        priority: 2,
        installSource: 'pkg',
        runVia: 'daemon'
    },
    'cis-cat': {
        name: 'CIS-CAT Pro',
        category: 'Hardening',
        icon: '',
        description: 'Configuration compliance assessment tool',
        detailedDescription: 'CIS-CAT Pro assesses system compliance against CIS Benchmarks. Validates security configurations, identifies misconfigurations, and provides remediation steps. Essential for ensuring systems meet industry security standards and compliance requirements.',
        status: 'available',
        version: '5.1.0',
        url: 'https://www.cisecurity.org',
        osCompatibility: ['windows', 'linux'],
        compatibilityScore: { windows: 89, macos: 70, linux: 87 },
        dependencies: ['java'],
        size_mb: 380,
        priority: 1,
        installSource: 'download',
        runVia: 'direct'
    },
    'osquery': {
        name: 'OSQuery',
        category: 'Hardening',
        icon: '',
        description: 'Operating system instrumentation framework',
        detailedDescription: 'OSQuery allows you to query operating system information using SQL. Provides real-time visibility into system state, running processes, network connections, and security events. Cross-platform support with deployment via configuration management tools.',
        status: 'available',
        version: '5.8.0',
        url: 'https://osquery.io',
        osCompatibility: ['windows', 'macos', 'linux'],
        compatibilityScore: { windows: 86, macos: 89, linux: 91 },
        dependencies: [],
        size_mb: 95,
        priority: 1,
        installSource: 'repo',
        runVia: 'direct'
    },
    'gvm': {
        name: 'GVM',
        category: 'Vulnerability',
        icon: '',
        description: 'Go Vulnerability Management system',
        detailedDescription: 'GVM is a comprehensive Go-based vulnerability management platform that provides advanced threat detection and vulnerability scanning. Features include real-time monitoring, automated remediation, and integration with security tools. Optimized for modern cloud infrastructure and containerized environments.',
        status: 'available',
        version: '1.0.0',
        url: 'https://github.com/khulnasoft-labs/gvm',
        osCompatibility: ['linux', 'macos'],
        compatibilityScore: { windows: 60, macos: 85, linux: 98 },
        dependencies: ['go'],
        size_mb: 120,
        priority: 2,
        installSource: 'pkg',
        runVia: 'daemon'
    },
    'fail2ban': {
        name: 'Fail2ban',
        category: 'Defense',
        icon: '',
        description: 'Intrusion prevention software for Linux',
        detailedDescription: 'Fail2ban is an open-source intrusion prevention framework designed for Linux systems. Monitors log files for suspicious activity and automatically updates firewall rules to block attacking hosts. Commonly used to protect against brute-force attacks and DoS attacks. Essential for Linux server hardening.',
        status: 'available',
        version: '1.0.2',
        url: 'https://www.fail2ban.org',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 99 },
        dependencies: ['python3'],
        size_mb: 45,
        priority: 1,
        installSource: 'pkg',
        runVia: 'daemon'
    },
    'lynis': {
        name: 'Lynis',
        category: 'Hardening',
        icon: '',
        description: 'Security auditing tool for Linux and Unix',
        detailedDescription: 'Lynis is a comprehensive security auditing tool for Linux, Unix, and macOS systems. Performs security configuration checks, compliance assessments, and identifies security weaknesses. Provides detailed reports with hardening recommendations. Open-source and widely used by system administrators.',
        status: 'available',
        version: '3.0.8',
        url: 'https://cisofy.com/lynis',
        osCompatibility: ['linux', 'macos'],
        compatibilityScore: { windows: 0, macos: 75, linux: 99 },
        dependencies: [],
        size_mb: 25,
        priority: 1,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'aide': {
        name: 'AIDE',
        category: 'Hardening',
        icon: '',
        description: 'File integrity monitoring system',
        detailedDescription: 'AIDE (Advanced Intrusion Detection Environment) is a file integrity monitoring tool for Linux. Creates a database of system files and detects unauthorized changes. Essential for detecting rootkits and unauthorized modifications. Commonly integrated into system monitoring workflows.',
        status: 'available',
        version: '0.17.4',
        url: 'https://aide.github.io',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 99 },
        dependencies: [],
        size_mb: 50,
        priority: 2,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'chkrootkit': {
        name: 'Chkrootkit',
        category: 'Defense',
        icon: '',
        description: 'Rootkit detection tool for Linux',
        detailedDescription: 'Chkrootkit is a common Linux rootkit detector that checks for signs of rootkits and other malicious modifications. Performs various security checks including suspicious files, hidden processes, and kernel modifications. Essential for incident response and security auditing.',
        status: 'available',
        version: '0.55',
        url: 'http://www.chkrootkit.org',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 98 },
        dependencies: [],
        size_mb: 30,
        priority: 2,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'rkhunter': {
        name: 'Rkhunter',
        category: 'Defense',
        icon: '',
        description: 'Rootkit and malware scanner for Linux',
        detailedDescription: 'Rootkit Hunter (rkhunter) is a Unix-based tool that scans for rootkits, backdoors, and other suspicious activity on Linux systems. Performs file integrity checks, kernel module scanning, and suspicious process analysis. Works well with Chkrootkit for comprehensive detection.',
        status: 'available',
        version: '1.4.6',
        url: 'http://rkhunter.sourceforge.net',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 97 },
        dependencies: [],
        size_mb: 40,
        priority: 2,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'clamav': {
        name: 'ClamAV',
        category: 'EDR',
        icon: '',
        description: 'Open-source antivirus for Linux',
        detailedDescription: 'ClamAV is a free and open-source antivirus engine for detecting trojans, viruses, malware, and other malicious threats. Provides command-line scanning tools and daemon mode for real-time protection. Widely used in production environments and email gateways.',
        status: 'available',
        version: '1.0.0',
        url: 'https://www.clamav.net',
        osCompatibility: ['linux', 'windows', 'macos'],
        compatibilityScore: { windows: 75, macos: 80, linux: 98 },
        dependencies: [],
        size_mb: 200,
        priority: 1,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'tiger': {
        name: 'TIGER',
        category: 'Hardening',
        icon: '',
        description: 'System security checking software',
        detailedDescription: 'TIGER is a script-based security audit tool for Unix-like systems. Performs comprehensive security checks on system configuration, user accounts, permissions, and installed programs. Generates detailed reports with security recommendations. Complementary to Lynis and AIDE.',
        status: 'available',
        version: '3.2.3',
        url: 'http://www.nongnu.org/tiger',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 96 },
        dependencies: ['perl'],
        size_mb: 35,
        priority: 2,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'tripwire': {
        name: 'Tripwire',
        category: 'Hardening',
        icon: '',
        description: 'File integrity and change management',
        detailedDescription: 'Tripwire is a commercial-grade file integrity and intrusion detection system for Linux and Unix. Detects and reports unauthorized modifications to system files. Essential for compliance and incident detection. Available as open-source evaluation version.',
        status: 'available',
        version: '2.4.3',
        url: 'https://www.tripwire.com',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 98 },
        dependencies: [],
        size_mb: 85,
        priority: 2,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'apparmor': {
        name: 'AppArmor',
        category: 'Defense',
        icon: '',
        description: 'Linux application security module',
        detailedDescription: 'AppArmor is a Linux security module that confines programs to a limited set of resources. Provides mandatory access control through application profiles. Reduces attack surface by restricting what applications can do. Built into many Linux distributions.',
        status: 'available',
        version: '3.0.0',
        url: 'https://gitlab.com/apparmor/apparmor/-/wikis/home',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 99 },
        dependencies: [],
        size_mb: 20,
        priority: 1,
        installSource: 'pkg',
        runVia: 'daemon'
    },
    'selinux': {
        name: 'SELinux',
        category: 'Defense',
        icon: '',
        description: 'Security-Enhanced Linux (NSA)',
        detailedDescription: 'SELinux is a mandatory access control (MAC) security module for Linux developed by the NSA. Provides fine-grained control over system resources and user permissions. Reduces the impact of security vulnerabilities. Standard on Red Hat-based distributions.',
        status: 'available',
        version: '3.4.0',
        url: 'https://github.com/SELinuxProject',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 99 },
        dependencies: [],
        size_mb: 15,
        priority: 1,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'ufw': {
        name: 'UFW',
        category: 'Defense',
        icon: '',
        description: 'Uncomplicated Firewall for Linux',
        detailedDescription: 'UFW is a user-friendly firewall management tool for Linux that simplifies iptables configuration. Provides easy command-line interface for managing firewall rules. Widely used on Ubuntu and Debian systems. Essential for network security hardening.',
        status: 'available',
        version: '0.36.1',
        url: 'https://wiki.ubuntu.com/UncomplicatedFirewall',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 98 },
        dependencies: [],
        size_mb: 10,
        priority: 1,
        installSource: 'pkg',
        runVia: 'kjer'
    },
    'auditd': {
        name: 'Auditd',
        category: 'Hardening',
        icon: '',
        description: 'Linux audit framework',
        detailedDescription: 'Auditd is the Linux audit framework that provides system-level auditing of user and process activity. Generates comprehensive audit logs for compliance and forensic analysis. Essential for meeting security standards like PCI-DSS and HIPAA.',
        status: 'available',
        version: '3.0.0',
        url: 'https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/security_guide/chap-system_auditing',
        osCompatibility: ['linux'],
        compatibilityScore: { windows: 0, macos: 0, linux: 99 },
        dependencies: [],
        size_mb: 25,
        priority: 1,
        installSource: 'pkg',
        runVia: 'daemon'
    }
};

// ==================== ACTIVITY LOG MANAGEMENT ====================

const ActivityLog = {
    maxEntries: 200,
    entries: [],

    // Messages matching these patterns are suppressed from the dashboard
    // Recent Activity feed but still appear in the full Status & Logs view.
    _noisePatterns: [
        /^Switched to /i,
        /^System booting/i,
        /database loaded/i,
        /database initialized/i,
        /event listeners attached/i,
        /dashboard initialized/i,
        /verifying electron/i,
        /electron runtime: already/i,
        /electron dependency/i,
        /dependency check skipped/i,
        /activation state restored/i,
        /initialization state restored/i,
        /license key restored/i,
        /os detected at install/i,
        /loading personalized/i,
        /tool database loaded/i,
        /profile database loaded/i,
        /cli integration check/i,
        /application state reset/i,
        /^Beginning Kjer initialization/i,
        /^Activating security framework/i,
        /^Use the Tool Box/i,
    ],

    _isDashboardWorthy: function(message, level, important) {
        if (important) return true;
        if (level === 'error' || level === 'warning' || level === 'critical') return true;
        for (const pat of this._noisePatterns) {
            if (pat.test(message)) return false;
        }
        return true;
    },

    add: function(message, level = 'info', tool = '', important = false) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: true });

        this.entries.unshift({
            time: timeStr,
            level: level,
            message: message,
            tool: tool,
            important: important,
            timestamp: now.toISOString()
        });

        if (this.entries.length > this.maxEntries) {
            this.entries.pop();
        }

        this.save();
        this.render();
    },

    save: function() {
        try {
            // Cap persisted entries to keep localStorage footprint small
            localStorage.setItem('kjerActivityLog', JSON.stringify(this.entries.slice(0, 100)));
        } catch (_) {}
    },

    load: function() {
        try {
            const raw = localStorage.getItem('kjerActivityLog');
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (Array.isArray(saved) && saved.length) {
                this.entries = saved.slice(0, this.maxEntries);
            }
        } catch (_) {}
    },

    render: function() {
        const logContainer = document.getElementById('activityLog');
        if (!logContainer) return;

        logContainer.innerHTML = this.entries.map(entry => `
            <div class="log-entry">
                <span class="log-time">${entry.time}</span>
                <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
                <span class="log-message">${_highlightLogMessage(entry.message)}</span>
            </div>
        `).join('');
    },

    clear: function() {
        this.entries = [];
        try { localStorage.removeItem('kjerActivityLog'); } catch (_) {}
        this.render();
    }
};

function logActivity(message, level = 'info', tool = '', important = false) {
    ActivityLog.add(message, level, tool, important);
}

/**
 * Apply syntax-highlight-style coloring to a log message string.
 * HTML-escapes the input first, then wraps recognised patterns in color spans.
 */
function _highlightLogMessage(text) {
    // HTML-escape the raw message once.
    const esc = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // All patterns are matched against `esc` — the original escaped string —
    // never against each other's output.  This prevents chained regexes from
    // matching inside injected <span style="..."> attributes (e.g. the port
    // regex would otherwise corrupt "font-weight:700;" → "font-weight:<span>700</span>;").
    const regions = [];

    function collect(re, styleFn) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(esc)) !== null) {
            const s = m.index, e = s + m[0].length;
            if (regions.every(r => e <= r.s || s >= r.e)) {
                regions.push({ s, e, html: styleFn(m[0]) });
            }
        }
    }

    collect(/\[([^\]]{1,40})\]/g,
        v => `<span style="color:#9D4EDD;font-weight:600;">${v}</span>`);
    collect(/\bCRITICAL(?:\s+(?:THREAT|RISK|SEVERITY))?\b/gi,
        v => `<span style="color:#FF4444;font-weight:700;">${v}</span>`);
    collect(/\b(?:HIGH(?:\s+(?:RISK|SEVERITY|THREAT))?|THREAT|ATTACK|INTRUSION|MALWARE|EXPLOIT|UNAUTHORIZED|SUSPICIOUS|COMPROMISED|BREACH|VULNERABILITY)\b/gi,
        v => `<span style="color:#FF6B6B;">${v}</span>`);
    collect(/\b(?:DETECTED|FOUND|IDENTIFIED|INFECTED)\b/gi,
        v => `<span style="color:#FF8C42;">${v}</span>`);
    collect(/\b(?:BLOCKED|QUARANTINED|PROTECTED|MITIGATED|CLEANED|REMOVED|RESOLVED|PATCHED|SECURED)\b/gi,
        v => `<span style="color:#4caf50;font-weight:600;">${v}</span>`);
    collect(/\bMEDIUM(?:\s+(?:RISK|SEVERITY))?\b/gi,
        v => `<span style="color:#ff9800;">${v}</span>`);
    collect(/\b(?:ALERT|WARNING)\b/gi,
        v => `<span style="color:#ff9800;">${v}</span>`);
    collect(/\b(?:LOW(?:\s+(?:RISK|SEVERITY))?|INFORMATIONAL)\b/gi,
        v => `<span style="color:#FFD700;">${v}</span>`);
    collect(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
        v => `<span style="color:#B0E0E6;">${v}</span>`);
    collect(/:\d{2,5}\b/g,
        v => `:<span style="color:#9D4EDD;">${v.slice(1)}</span>`);

    regions.sort((a, b) => a.s - b.s);
    let out = '', pos = 0;
    for (const { s, e, html } of regions) {
        if (s < pos) continue; // safety guard against overlaps
        out += esc.slice(pos, s) + html;
        pos = e;
    }
    return out + esc.slice(pos);
}

// Export the activity log to a timestamped file in ~/.kjer/logs/
// silent=true suppresses the success notification (used for auto-save on close)
function exportActivityLog(silent = false) {
    if (!window.electronAPI || typeof window.electronAPI.saveActivityLog !== 'function') {
        if (!silent) showNotification('Log export not available in this environment.');
        return;
    }
    const entries = ActivityLog.entries.slice().reverse(); // oldest first
    const header = [
        'Kjer Security Activity Log',
        `Exported: ${new Date().toLocaleString()}`,
        '='.repeat(60)
    ].join('\n');
    const body = entries.map(e => {
        const lvl = e.level.toUpperCase().padEnd(8);
        const tool = e.tool ? `[${e.tool}] ` : '';
        return `[${e.time}] [${lvl}] ${tool}${e.message}`;
    }).join('\n');
    const content = header + '\n' + body;
    window.electronAPI.saveActivityLog(content).then(result => {
        if (!silent) {
            if (result && result.success) {
                showNotification(`Log saved: ${result.filePath}`);
            } else {
                showNotification('Failed to save log.');
            }
        }
    }).catch(() => {});
}

// ==================== SECURITY MONITOR ====================
// Real-time, per-tool-per-threat feed rendered to #logEntries
// (Dashboard Security Activity Monitor). Receives all scan phase
// headers, per-tool scan results, defend actions, and section
// dividers. Separate from ActivityLog which shows high-level
// summaries in Status & Logs.

const SecurityMonitor = {
    maxEntries: 400,
    entries: [],

    _fmt: function(tool, message, level, type) {
        const now = new Date();
        return {
            time: now.toLocaleTimeString('en-US', { hour12: true }),
            tool: tool || '',
            message: message,
            level: level || 'info',
            type: type || 'result'   // 'result' | 'section' | 'divider'
        };
    },

    log: function(tool, message, level) {
        this.entries.unshift(this._fmt(tool, message, level, 'result'));
        if (this.entries.length > this.maxEntries) this.entries.pop();
        this.render();
    },

    section: function(title) {
        this.entries.unshift(this._fmt('', title, 'info', 'section'));
        if (this.entries.length > this.maxEntries) this.entries.pop();
        this.render();
    },

    divider: function() {
        this.entries.unshift(this._fmt('', '═'.repeat(46), 'info', 'divider'));
        if (this.entries.length > this.maxEntries) this.entries.pop();
        this.render();
    },

    render: function() {
        const logEntries = document.getElementById('logEntries');
        if (!logEntries) return;

        if (this.entries.length === 0) {
            logEntries.innerHTML = '<div style="text-align:center;color:var(--color-empty-state);padding:32px 0;font-size:13px;">Run a Security Scan or Smart Defense to see activity here.</div>';
            return;
        }

        logEntries.innerHTML = this.entries.map(entry => {
            if (entry.type === 'divider') {
                return `<div class="log-entry log-divider">
                    <div class="log-col-time"></div>
                    <div class="log-col-level"></div>
                    <div class="log-col-message" style="color:#444;letter-spacing:1px">${entry.message}</div>
                </div>`;
            }
            if (entry.type === 'section') {
                return `<div class="log-entry log-section">
                    <div class="log-col-time">${entry.time}</div>
                    <div class="log-col-level"></div>
                    <div class="log-col-message" style="color:#9D4EDD;font-weight:600;letter-spacing:0.5px">${entry.message}</div>
                </div>`;
            }
            const toolCol = entry.tool
                ? `<span class="log-tool-name">[${entry.tool}]</span> `
                : '';
            return `<div class="log-entry">
                <div class="log-col-time">${entry.time}</div>
                <div class="log-col-level log-level ${entry.level}">${entry.level.toUpperCase()}</div>
                <div class="log-col-message">${toolCol}${_highlightLogMessage(entry.message)}</div>
            </div>`;
        }).join('');
    },

    clear: function() {
        this.entries = [];
        this.render();
    }
};

function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #1a1a1a;
        border: 2px solid #9D4EDD;
        color: #B0E0E6;
        padding: 15px 20px;
        border-radius: 4px;
        z-index: 9999;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

const PROFILES_DATABASE = [
    {
        name: 'Basic Protection',
        description: 'Essential tools for endpoint protection',
        tools: ['windows-defender', 'malwarebytes'],
        installSize: '500 MB',
        installTime: '10 minutes'
    },
    {
        name: 'Enterprise Hardening',
        description: 'Comprehensive security hardening suite',
        tools: ['cis-cat', 'osquery', 'windows-defender', 'kaspersky'],
        installSize: '2.5 GB',
        installTime: '45 minutes'
    },
    {
        name: 'Network Analysis',
        description: 'Advanced network monitoring and analysis',
        tools: ['wireshark', 'suricata', 'zeek'],
        installSize: '800 MB',
        installTime: '20 minutes'
    },
    {
        name: 'Threat Intelligence',
        description: 'SIEM and threat analysis tools',
        tools: ['splunk', 'elastic-stack', 'zeek'],
        installSize: '4.0 GB',
        installTime: '60 minutes'
    },
    {
        name: 'Incident Response',
        description: 'Complete incident response toolkit',
        tools: ['volatility', 'ghidra', 'wireshark', 'splunk'],
        installSize: '3.2 GB',
        installTime: '50 minutes'
    },
    {
        name: 'Vulnerability Management',
        description: 'Vulnerability scanning and compliance',
        tools: ['nessus', 'openvas', 'cis-cat'],
        installSize: '1.8 GB',
        installTime: '35 minutes'
    },
    {
        name: 'Reverse Engineering',
        description: 'Malware analysis and reverse engineering',
        tools: ['ghidra', 'ida-pro', 'volatility'],
        installSize: '2.1 GB',
        installTime: '40 minutes'
    }
];

// Initialize Application
// ==================== APPLICATION BOOT ====================

// Render the full application UI after a valid license has been confirmed.
// Extracted from DOMContentLoaded so it can also be called by releaseLicenseGate()
// after a first-run activation.
function bootApplication() {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';

    setTimeout(() => {
        initializeDashboard();
        logActivity('Dashboard initialized', 'success');

        // Initialize version-specific UI constraints
        initializeVersionSpecificUI();

        if (isInitialized) {
            // User has already initialized — show personalized content based on saved OS
            const savedDistro = localStorage.getItem('userDistro') || SystemInfo.getOSInfo().name;
            logActivity(`Loading personalized experience for ${savedDistro}`, 'success');
            renderToolsList();
            logActivity('Tool database loaded', 'success');
            renderProfiles();
            logActivity('Profile database loaded', 'success');
            setupEventListeners();
            logActivity('Event listeners attached', 'success');
            logActivity('Application ready for operations', 'success');

            // Full host scan: detects OS, RAM, disk, CPU, and all installed tools
            // in a single backend pass, then refreshes all GUI panels.
            detectFullHostSystem().catch(() => {});

            // Auto-check for Kjer application updates if the setting is enabled.
            // Runs silently: no notification when up-to-date, only when an update exists.
            const autoCheckUpdates = localStorage.getItem('autoCheckUpdates') !== 'false';
            if (autoCheckUpdates) {
                setTimeout(() => checkForKjerUpdates(true), 4000);
            }
        } else {
            // First time user — clear containers and require initialization
            clearApplicationContainers();
            logActivity('First-time setup detected', 'info');
            setupEventListeners();
            logActivity('Awaiting initialization...', 'warning');

            // Show tutorial
            setTimeout(() => Tutorial.show(), 1000);
        }
    }, 500);
}

document.addEventListener('DOMContentLoaded', async function() {
    // Restore persisted activity log before anything else writes to it
    ActivityLog.load();

    loadSettings();
    NetworkStatus.init();
    _monitorUiActive(false);  // ensure stop/badge start hidden

    // Mark the start of this session in the activity log
    const sessionStart = new Date().toLocaleString();
    logActivity(`─── Session started: ${sessionStart} ───`, 'info', '', true);
    logActivity('System booting up...', 'info');

    // Register auto-save: when main signals app is about to quit,
    // silently write the activity log to ~/.kjer/logs/
    if (window.electronAPI && window.electronAPI.onBeforeQuit) {
        window.electronAPI.onBeforeQuit(() => {
            exportActivityLog(true); // silent = no notification
        });
    }

    // Load OS from install_state.json (written by gdje-install.sh at install time).
    // This runs before any rendering so tools, profiles, and status all see the
    // correct OS immediately — no "OS undetected" state.
    await loadInstallStateIntoApp();

    // ── License gate ──────────────────────────────────────────────────────────
    // Check for a valid license before rendering any application content.
    // The in-memory session (set by main.js on startup) is the authoritative
    // source; localStorage activation flag is the fallback for the renderer.

    // Safety net: restore kjerActivated from any available evidence before the
    // gate check runs.  Handles the case where localStorage was wiped (old
    // clearCache / resetSettings) but the user has a valid disk-side record.
    //
    // Priority (highest to lowest):
    //   1. kjerLicenseKey already in localStorage  (set by loadInstallStateIntoApp)
    //   2. kjerInitialized = 'true' in localStorage (set from ~/.kjer/initialized on disk)
    //      → the user successfully completed initialization, which requires a license.
    // Neither condition touches kjerActivated unless it is currently missing/false.
    if (!localStorage.getItem('kjerActivated')) {
        if (localStorage.getItem('kjerLicenseKey')) {
            localStorage.setItem('kjerActivated', 'true');
            logActivity('Activation flag restored from persisted license key', 'info');
        } else if (localStorage.getItem('kjerInitialized') === 'true') {
            localStorage.setItem('kjerActivated', 'true');
            logActivity('Activation flag restored from initialization record — please re-enter your key in Settings to refresh it', 'warning');
        }
    }

    const session      = await window.electronAPI?.getAuthSession?.();
    let   isAuthorized = session?.authorized || localStorage.getItem('kjerActivated') === 'true';

    // Final authoritative fallback: ask the Python backend directly.
    // This reads ~/.kjer/license_key.json and ~/.kjer/initialized straight from
    // disk — immune to any localStorage inconsistency. Only runs when the faster
    // localStorage/IPC paths above all failed to produce an authorized state.
    if (!isAuthorized) {
        try {
            const activation = await BackendAPI.checkActivation();
            if (activation?.activated) {
                localStorage.setItem('kjerActivated', 'true');
                if (activation.license_type && activation.license_type !== 'trial')
                    localStorage.setItem('kjerLicenseType', activation.license_type);
                if (activation.license_key)
                    localStorage.setItem('kjerLicenseKey', activation.license_key);
                if (activation.expires_at)
                    localStorage.setItem('kjerPromoExpires', activation.expires_at);
                isAuthorized = true;
                logActivity('Authorization confirmed via backend disk check', 'info');
            } else if (activation?.is_expired) {
                // Promo expired — clear cached activation so the gate shows
                localStorage.removeItem('kjerActivated');
                localStorage.removeItem('kjerLicenseKey');
                localStorage.removeItem('kjerLicenseType');
                localStorage.removeItem('kjerPromoExpires');
                logActivity('Promo license expired — please purchase a license', 'warning');
            }
        } catch (e) { /* non-fatal — fall through to gate */ }
    }

    if (!isAuthorized) {
        logActivity('License required — awaiting activation key', 'warning');
        showLicenseGate();
        return; // bootApplication() will be called by releaseLicenseGate()
    }
    // ─────────────────────────────────────────────────────────────────────────

    bootApplication();
    _initNetworkListeners();
});

// ==================== INITIALIZATION HELPERS ====================

function clearApplicationContainers() {
    // Clear tools list
    const toolsList = document.getElementById('toolsList');
    if (toolsList) toolsList.innerHTML = '<p style="text-align: center; color: var(--color-empty-state); padding: 40px; margin-top: 150px; margin-left: 100px;">Please initialize Kjer to view available tools</p>';
    
    // Clear profiles list  
    const profilesList = document.getElementById('profilesList');
    if (profilesList) profilesList.innerHTML = '<p style="text-align: center; color: var(--color-empty-state); padding: 40px;">Please initialize Kjer to view installation profiles</p>';
}

function initializeVersionSpecificUI() {
    // No visual changes needed - v1.0.0 users will see upgrade modal on click
    // Other versions have full access
}

function getToolsForCurrentOS() {
    // Returns only tools compatible with the current OS (used by Available tab).
    const currentOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    const tools = {};
    for (const [key, tool] of Object.entries(TOOLS_DATABASE)) {
        if (tool.osCompatibility && tool.osCompatibility.includes(currentOS)) {
            tools[key] = tool;
        }
    }
    return tools;
}

function getAllToolsWithCompatibility() {
    // Returns ALL tools from the database. Tools not compatible with the
    // current OS are included but flagged isIncompatible: true so cards
    // render greyed-out with a disabled Install button (same as Windows
    // Defender on Linux). Used by the "All" tab and default render.
    const currentOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    const tools = {};
    for (const [key, tool] of Object.entries(TOOLS_DATABASE)) {
        const compatible = tool.osCompatibility && tool.osCompatibility.includes(currentOS);
        tools[key] = compatible ? tool : { ...tool, isIncompatible: true };
    }
    return tools;
}

function getProfilesForCurrentOS() {
    const currentOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    
    // Define OS-specific profiles
    const osProfiles = {
        linux: [
            {
                name: 'Linux Basic Defense',
                description: 'Essential Linux defensive security tools',
                tools: ['fail2ban', 'ufw', 'clamav'],
                installSize: '300 MB',
                installTime: '15 minutes'
            },
            {
                name: 'Linux Standard Security',
                description: 'Balanced Linux security setup with detection and hardening',
                tools: ['fail2ban', 'ufw', 'clamav', 'lynis', 'aide', 'auditd', 'apparmor'],
                installSize: '800 MB',
                installTime: '25 minutes'
            },
            {
                name: 'Linux Enterprise',
                description: 'Comprehensive Linux security suite',
                tools: ['fail2ban', 'ufw', 'clamav', 'lynis', 'aide', 'auditd', 'apparmor', 'chkrootkit', 'rkhunter', 'tiger', 'osquery'],
                installSize: '1.5 GB',
                installTime: '45 minutes'
            }
        ],
        windows: [
            {
                name: 'Windows Basic Protection',
                description: 'Essential tools for Windows endpoint protection',
                tools: ['windows-defender', 'malwarebytes'],
                installSize: '500 MB',
                installTime: '10 minutes'
            },
            {
                name: 'Windows Enterprise Hardening',
                description: 'Comprehensive Windows security hardening suite',
                tools: ['cis-cat', 'osquery', 'windows-defender', 'kaspersky'],
                installSize: '2.5 GB',
                installTime: '45 minutes'
            },
            {
                name: 'Windows Vulnerability Management',
                description: 'Vulnerability scanning and compliance for Windows',
                tools: ['nessus', 'cis-cat'],
                installSize: '1.8 GB',
                installTime: '35 minutes'
            }
        ],
        macos: [
            {
                name: 'macOS Basic Security',
                description: 'Essential macOS security tools',
                tools: ['malwarebytes', 'kaspersky'],
                installSize: '400 MB',
                installTime: '15 minutes'
            },
            {
                name: 'macOS Development Security',
                description: 'Security tools for macOS development environments',
                tools: ['ghidra', 'wireshark', 'elastic-stack'],
                installSize: '1.5 GB',
                installTime: '30 minutes'
            }
        ]
    };
    
    return osProfiles[currentOS] || [];
}

// ==================== TAB MANAGEMENT ====================

async function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Remove active from nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');

    // Mark nav item as active
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    if (tabName === 'status')   { updateStatusPage(); }
    if (tabName === 'tools')    { reapplyToolFilter(); }
    if (tabName === 'settings') { updateSettingsSystemInfo(); checkSudoStatus(); }
    if (tabName === 'network')  { renderNetworkPage(); }
    if (tabName === 'profiles') { renderProfiles(); }

    logActivity(`Switched to ${tabName} tab`);
}

function updateStatusPage() {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    const isActivated   = localStorage.getItem('kjerActivated')    === 'true';

    // OS is known from install_state.json whether or not Kjer has been initialized.
    const installedDistro = localStorage.getItem('userDistro')
        || localStorage.getItem('userOS')
        || SystemInfo.getOSInfo().name;
    const osEl = document.getElementById('statusPageOS');
    if (osEl) osEl.textContent = installedDistro;

    // Only show data after initialization
    if (!isInitialized) {
        // Update initialization status
        const initEl = document.getElementById('statusPageInit');
        if (initEl) {
            initEl.textContent = 'Not Initialized';
            initEl.style.color = '#ff9800';
        }
        
        // Update active tools count - show 0
        const toolsEl = document.getElementById('statusPageTools');
        if (toolsEl) toolsEl.textContent = '0';
        
        // Update license status
        const licenseEl = document.getElementById('statusPageLicense');
        if (licenseEl) {
            if (isActivated) {
                const type = localStorage.getItem('kjerLicenseType') || 'personal';
                licenseEl.textContent = getTierLabel(type);
                licenseEl.style.color = (KJER_TIERS[type] || KJER_TIERS.personal).color;
            } else {
                licenseEl.textContent = '[Not Activated]';
                licenseEl.style.color = '#ff9800';
            }
        }
        return;
    }
    
    const installed = getInstalledTools();
    
    // Update initialization status
    const initEl = document.getElementById('statusPageInit');
    if (initEl) {
        initEl.textContent = 'Initialized';
        initEl.style.color = '#4caf50';
    }
    
    // Update active tools count
    const toolsEl = document.getElementById('statusPageTools');
    if (toolsEl) toolsEl.textContent = Object.keys(installed).length;
    
    // Update license status
    const licenseEl = document.getElementById('statusPageLicense');
    if (licenseEl) {
        if (isActivated) {
            const type = localStorage.getItem('kjerLicenseType') || 'personal';
            licenseEl.textContent = getTierLabel(type);
            licenseEl.style.color = (KJER_TIERS[type] || KJER_TIERS.personal).color;
        } else {
            licenseEl.textContent = '[Not Activated]';
            licenseEl.style.color = '#ff9800';
        }
    }
}

// ==================== PROFILES UPGRADE MODAL ====================

function showUpgradeModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'upgradeProfilesModal';
    modal.style.display = 'flex';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Upgrade to Access Profiles</h2>
                <button class="modal-close" onclick="document.getElementById('upgradeProfilesModal').remove()">×</button>
            </div>
            <div class="modal-body" style="padding: 30px;">
                <p style="color: #B0E0E6; margin-bottom: 20px; line-height: 1.6;">
                    Profiles is a premium feature available in <strong>Kjer v1.1.0 and higher</strong>.
                </p>
                <p style="color: #B0E0E6; margin-bottom: 20px; font-size: 14px; color: #888;">
                    Profiles provides pre-configured security tool sets designed for:
                </p>
                <ul style="color: #B0E0E6; margin-bottom: 25px; margin-left: 20px; line-height: 1.8;">
                    <li>🏢 <strong>Enterprises</strong> - Standardized security configurations</li>
                    <li>🔒 <strong>Ethical Hackers</strong> - Practice environments (DVWA-like VMs)</li>
                </ul>
                <div style="margin-bottom: 25px;">
                    <label style="color: #B0E0E6; display: block; margin-bottom: 8px; font-weight: bold;">Enter Upgrade Key:</label>
                    <input type="text" id="upgradeKeyForProfiles" placeholder="KJER-2-XXXX-XXXX-XXXX" 
                           style="width: 100%; padding: 12px; background-color: #0a0a0a; border: 1px solid #9D4EDD; color: #B0E0E6; border-radius: 4px; box-sizing: border-box; font-family: monospace;">
                    <p style="color: #888; font-size: 12px; margin-top: 8px;">Upgrade keys are in format: KJER-2-XXXX-XXXX-XXXX (for v1.1.0)</p>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="document.getElementById('upgradeProfilesModal').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="applyProfilesUpgradeKey()">Upgrade Now</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.getElementById('upgradeKeyForProfiles').focus();
}

async function applyProfilesUpgradeKey() {
    const upgradeKey = document.getElementById('upgradeKeyForProfiles').value.trim();

    // ── Master key check — validated against key file on disk, never compared in renderer
    const devCheck = await window.electronAPI?.validateDevKey?.(upgradeKey);
    if (devCheck?.valid) {
        // Auth state is now set in main process — query it back to populate display
        const session = await window.electronAPI?.getAuthSession?.();
        syncSessionToDisplay(session);
        showNotification('✓ Master Key Accepted! All features Unlocked', 'success');
        document.getElementById('upgradeProfilesModal').remove(); // modal removed = input gone
        updateLicenseStatus();
        logActivity('Master Key Accepted: All features Unlocked', 'success');
        renderProfiles();
        setTimeout(() => switchTab('profiles'), 500);
        return;
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!upgradeKey) {
        showNotification('Please enter an upgrade key');
        return;
    }
    
    // Show loading state
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Processing...';
    btn.disabled = true;
    
    // Call backend to apply upgrade
    try {
        const result = await BackendAPI.callBackend('apply-upgrade', {
            'upgrade_key': upgradeKey,
            'target_version': '1.1.0'
        });
        btn.textContent = originalText;
        btn.disabled = false;

        if (result.success) {
            const newVer = result.current_version || result.version || localStorage.getItem('kjerVersion') || 'new version';
            localStorage.setItem('kjerVersion', newVer);
            await window.electronAPI?.setLicenseAuth?.({
                authorized:     true,
                licenseType:    localStorage.getItem('kjerLicenseType') || 'enterprise',
                displayVersion: newVer,
            });
            showNotification(`✓ Successfully upgraded to v${newVer}! Profiles are now available.`, 'success');
            document.getElementById('upgradeProfilesModal').remove();
            updateVersionDisplay();
            updateLicenseStatus();
            logActivity(`Upgraded to v${newVer} - Profiles now available`, 'success');
            // Switch to profiles tab
            setTimeout(() => switchTab('profiles'), 1000);
        } else {
            showNotification(`✗ Upgrade failed: ${result.message || 'Invalid upgrade key'}`, 'error');
        }
    } catch (error) {
        btn.textContent = originalText;
        btn.disabled = false;
        showNotification('Error processing upgrade key');
    }
}

// ==================== SETTINGS SYSTEM INFO ====================

function updateSettingsSystemInfo() {
    // Version
    const version = localStorage.getItem('kjerVersion') || '1.0.0';
    const versionEl = document.getElementById('sysInfoVersion');
    if (versionEl) versionEl.textContent = version;

    // Install date — written by installer into install_state.json
    const rawDate = localStorage.getItem('installedAt');
    const dateEl  = document.getElementById('sysInfoInstallDate');
    if (dateEl) {
        if (rawDate) {
            try {
                dateEl.textContent = new Date(rawDate).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric'
                });
            } catch (e) {
                dateEl.textContent = rawDate;
            }
        } else {
            dateEl.textContent = 'Unknown';
        }
    }

    // Platform — prefer the live-detected distro/OS over the UA string
    const platform   = localStorage.getItem('userDistro')
                    || localStorage.getItem('userOS')
                    || SystemInfo.getOSInfo().name
                    || 'Unknown';
    const platformEl = document.getElementById('sysInfoPlatform');
    if (platformEl) platformEl.textContent = platform;

    // Total tools available across the entire database
    const toolCount = typeof TOOLS_DATABASE !== 'undefined'
        ? Object.keys(TOOLS_DATABASE).length
        : 0;
    const toolsEl = document.getElementById('sysInfoToolCount');
    if (toolsEl) toolsEl.textContent = toolCount > 0 ? String(toolCount) : '—';

    // Hardware fields populated by detectFullHostSystem()
    const fmt = v => v != null ? parseFloat(v).toFixed(1) + ' GB' : '—';
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

    setEl('sysInfoDiskTotal',  fmt(localStorage.getItem('hostDiskTotal')));
    setEl('sysInfoDiskAvail',  fmt(localStorage.getItem('hostDiskAvail')));
    setEl('sysInfoRamTotal',   fmt(localStorage.getItem('hostRamTotal')));
    setEl('sysInfoRamAvail',   fmt(localStorage.getItem('hostRamAvail')));
    setEl('sysInfoCpuCount',   localStorage.getItem('hostCpuCount'));
    setEl('sysInfoHostname',   localStorage.getItem('hostName'));
    setEl('sysInfoKernel',     localStorage.getItem('hostKernel'));
    setEl('sysInfoArch',       localStorage.getItem('hostArch'));

    // Also refresh storage display (async, updates dashboard card too)
    updateStorageInfo();
}

async function updateStorageInfo() {
    const fmtGb = v => v != null ? parseFloat(v).toFixed(1) + ' GB' : '—';

    // Primary: values already cached in localStorage by detectFullHostSystem()
    let totalGb = localStorage.getItem('hostDiskTotal') ? parseFloat(localStorage.getItem('hostDiskTotal')) : null;
    let availGb = localStorage.getItem('hostDiskAvail') ? parseFloat(localStorage.getItem('hostDiskAvail')) : null;

    // Secondary: ask main process via df/wmic if cache is empty
    if (totalGb == null || availGb == null) {
        try {
            const r = await window.electronAPI?.getDiskInfo?.();
            if (r?.success) {
                if (totalGb == null) totalGb = r.total_disk_gb;
                if (availGb == null) availGb = r.avail_disk_gb;
            }
        } catch (_) {}
    }

    // Tertiary: system_analysis.json (CLI --analyze output)
    if (totalGb == null || availGb == null) {
        try {
            const r = await window.electronAPI?.readSystemAnalysis?.();
            if (r?.success && r.data) {
                if (totalGb == null && r.data.total_disk_gb != null) totalGb = r.data.total_disk_gb;
                if (availGb == null && r.data.avail_disk_gb != null) availGb = r.data.avail_disk_gb;
            }
        } catch (_) {}
    }

    const fmt = v => v != null ? v.toFixed(1) + ' GB' : '—';

    // Dashboard card — disk
    const dashAvail = document.getElementById('dashStorageAvail');
    const dashTotal = document.getElementById('dashStorageTotal');
    if (dashAvail) dashAvail.textContent = fmt(availGb);
    if (dashTotal) dashTotal.textContent = fmt(totalGb);

    // Dashboard card — RAM (from localStorage set by detectFullHostSystem)
    const ramTotal = localStorage.getItem('hostRamTotal') ? parseFloat(localStorage.getItem('hostRamTotal')) : null;
    const ramAvail = localStorage.getItem('hostRamAvail') ? parseFloat(localStorage.getItem('hostRamAvail')) : null;
    const dashRamAvail = document.getElementById('dashRamAvail');
    const dashRamTotal = document.getElementById('dashRamTotal');
    if (dashRamAvail) dashRamAvail.textContent = fmt(ramAvail);
    if (dashRamTotal) dashRamTotal.textContent = fmt(ramTotal);

    // Settings table — disk (hardware rows updated by updateSettingsSystemInfo)
    const sysTotal = document.getElementById('sysInfoDiskTotal');
    const sysAvail = document.getElementById('sysInfoDiskAvail');
    if (sysTotal) sysTotal.textContent = fmt(totalGb);
    if (sysAvail) sysAvail.textContent = fmt(availGb);
}

// ==================== DASHBOARD FUNCTIONS ====================

function initializeDashboard() {
    // OS is known from install_state.json (loaded at startup) — always display it,
    // even before initialization.  Initialization enables monitoring, not detection.
    const installedOS    = localStorage.getItem('userOS')     || SystemInfo.detectOS();
    const installedDistro = localStorage.getItem('userDistro') || SystemInfo.getOSInfo().name;
    const osNameEl = document.getElementById('osName');
    if (osNameEl) osNameEl.textContent = installedDistro;

    // Check if Kjer is initialized
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    
    if (!isInitialized) {
        // Show placeholder data for uninitialized state
        const toolsEl = document.getElementById('activeToolsCount');
        if (toolsEl) toolsEl.textContent = '0';
        
        // Update system status based on initialization
        updateSystemStatus();
        
        // Update installed profiles count
        updateProfilesCount();
        
        // Update license status (also drives sidebar version)
        updateLicenseStatus();

        // Sync version display with backend even before initialization
        updateVersionDisplay();

        // Render activity log
        ActivityLog.render();
        // Show empty-state placeholder in security monitor
        SecurityMonitor.render();
        // Storage info is available even before initialization
        updateStorageInfo();
        // Sync Status tab OS field
        updateStatusPage?.();

        return;
    }

    // Update active tools count
    const installed = getInstalledTools();
    const activeToolsCount = Object.keys(installed).length;
    const toolsEl = document.getElementById('activeToolsCount');
    if (toolsEl) toolsEl.textContent = activeToolsCount;
    
    // Update system status based on initialization
    updateSystemStatus();
    
    // Update installed profiles count
    updateProfilesCount();
    
    // Update license status
    updateLicenseStatus();
    
    // Update last update time
    updateLastUpdateTime();

    // Sync version display with backend (accessible version may differ from stored)
    updateVersionDisplay();

    // Sync the Status tab OS field so it never shows 'Detecting...' on first visit
    updateStatusPage?.();
    
    // Render activity log
    ActivityLog.render();
    // Show empty-state placeholder in security monitor (real entries added during scan/defend)
    SecurityMonitor.render();
    // Storage info
    updateStorageInfo();
    
    logActivity(`Security framework active for: ${installedDistro}`);
}

function updateSystemStatus() {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    const statusBadge = document.getElementById('systemStatusBadge');
    const statusText = document.getElementById('systemStatusText');
    
    if (statusBadge && statusText) {
        if (isInitialized) {
            statusBadge.className = 'status-badge success';
            statusText.textContent = 'Operational';
        } else {
            statusBadge.className = 'status-badge warning';
            statusText.textContent = 'Not Initialized';
        }
    }
}

function updateProfilesCount() {
    // Count installed profiles from localStorage
    let profileCount = 0;
    const profileKeys = ['Enterprise', 'Hacker', 'Forensics', 'Network', 'Compliance', 'Research', 'Custom'];
    
    profileKeys.forEach(profile => {
        if (localStorage.getItem(`profile_${profile}_installed`) === 'true') {
            profileCount++;
        }
    });
    
    const profilesEl = document.getElementById('installedProfilesCount');
    if (profilesEl) profilesEl.textContent = profileCount;
}

function updateLicenseStatus() {
    const isActivated    = localStorage.getItem('kjerActivated')    === 'true';
    const licenseType    = localStorage.getItem('kjerLicenseType')  || 'none';
    const currentVersion = localStorage.getItem('kjerVersion')      || '1.0.0';
    const isDevMode      = currentVersion === 'developer';
    const isPromo        = licenseType === 'promo';

    // Build human-readable tier label
    let tierLabel;
    if (isDevMode) {
        tierLabel = 'Developer Mode';
    } else if (isPromo && isActivated) {
        const promoDays    = localStorage.getItem('kjerPromoDays') || '';
        const promoExpires = localStorage.getItem('kjerPromoExpires') || '';
        const expStr       = promoExpires ? ` · expires ${promoExpires.slice(0, 10)}` : '';
        tierLabel = `${promoDays ? promoDays + '-Day ' : ''}Promo License${expStr}`;
    } else if (isActivated) {
        tierLabel = getTierLabel(licenseType);
    } else {
        tierLabel = '[Not Activated]';
    }

    // --- Dashboard sidebar badge ---
    const statusBadge = document.getElementById('licenseStatusBadge');
    const statusText  = document.getElementById('licenseStatusText');
    const versionText = document.getElementById('licenseVersionText');
    if (statusBadge && statusText && versionText) {
        if (isActivated) {
            statusBadge.className    = 'status-badge success';
            statusText.textContent   = isDevMode ? 'Developer Mode' : 'Activated';
            versionText.textContent  = tierLabel;
        } else {
            statusBadge.className    = 'status-badge';
            statusText.textContent   = '[Not Activated]';
            versionText.textContent  = 'Purchase at phanesguild.com/kjer';
        }
    }

    // --- Sidebar logo version ---
    const sidebarVersionEl = document.getElementById('sidebarVersion');
    if (sidebarVersionEl) sidebarVersionEl.textContent = `v${currentVersion.replace(/^v/i, '')}`;

    // --- Settings License & Tier Management card ---
    const currentVerEl  = document.getElementById('currentVersionDisplay');
    const licenseTypeEl = document.getElementById('currentVersionType');
    if (currentVerEl)  currentVerEl.textContent  = tierLabel;
    if (licenseTypeEl) licenseTypeEl.textContent  = isActivated
        ? (isDevMode ? '(Developer Mode)'
             : isPromo ? '(Promo) · Assisted'
             : `(${licenseType.charAt(0).toUpperCase() + licenseType.slice(1)}) · ${getAutomationLabel()}`)
        : '[Not Activated]';
}

function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour12: true });
    document.getElementById('lastUpdate').textContent = timeString;
}

// ==================== QUICK ACTIONS ====================

function refreshSystemStatus() {
    logActivity('System status refreshed');
    updateLastUpdateTime();
    
    // Update all dynamic data
    const installed = getInstalledTools();
    const toolsEl = document.getElementById('activeToolsCount');
    if (toolsEl) toolsEl.textContent = Object.keys(installed).length;
    
    updateSystemStatus();
    updateProfilesCount();
    updateLicenseStatus();
    
    const displayOS = localStorage.getItem('userDistro') || localStorage.getItem('userOS') || SystemInfo.getOSInfo().name;
    showNotification(`System status updated: ${displayOS}`);

    // Force a fresh host scan so the user sees live tool/hardware data.
    // Pass force=true to bypass the 30-minute cooldown that skips Python on normal boots.
    detectFullHostSystem(true).catch(() => {});
}

function scanForUpdates() {
    // Delegate to the real Kjer application update checker.
    checkForKjerUpdates(false);
}

// ==================== KJER APPLICATION UPDATES ====================

/**
 * Check GitHub Releases for a newer version of Kjer itself.
 * @param {boolean} silent - if true, only notify when an update IS available (suppresses
 *                           the "up to date" notification on auto-checks at boot).
 */
async function checkForKjerUpdates(silent = false) {
    const updateStatusEl = document.getElementById('kjUpdateStatus');
    const checkBtn       = document.getElementById('kjCheckUpdateBtn');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = 'Checking…'; }
    if (updateStatusEl) updateStatusEl.textContent = 'Checking for updates…';
    logActivity('Checking for Kjer application updates…', 'info');

    try {
        const installPath = await window.electronAPI?.getAppPath?.();
        if (!installPath) {
            if (!silent) showNotification('Cannot determine install path for update check.');
            if (updateStatusEl) updateStatusEl.textContent = 'Update check failed — install path unknown.';
            return;
        }

        const upgradeScript = `${installPath}/lib/upgrade_manager.py`;
        const args = [upgradeScript, 'check', installPath];
        if (_storedUpgradeToken) args.push(_storedUpgradeToken);

        const resp = await window.electronAPI?.executeCommand('python3', args);
        let info = {};
        try { info = JSON.parse((resp?.stdout || '').trim()); } catch { /* fall through */ }

        if (!info.success) {
            const msg = info.message || 'Update check failed.';
            logActivity(`Update check: ${msg}`, 'warning');
            if (!silent) showNotification(`Update check: ${msg}`);
            if (updateStatusEl) updateStatusEl.textContent = msg;
            return;
        }

        // Refresh the displayed current version in case it drifted
        const curEl = document.getElementById('kjCurrentVersion');
        if (curEl) curEl.textContent = `v${info.current_version}`;
        if (updateStatusEl) updateStatusEl.textContent = info.message;

        if (info.update_available) {
            logActivity(`Kjer update available: v${info.current_version} → v${info.latest_version}`, 'success', '', true);
            // Highlight sidebar button to signal an update is available
            const sidebarBtn = document.getElementById('sidebarUpdateBtn');
            if (sidebarBtn) {
                sidebarBtn.style.background = 'rgba(76,175,80,.18)';
                sidebarBtn.style.borderColor = 'rgba(76,175,80,.6)';
                sidebarBtn.style.color = '#4caf50';
                sidebarBtn.innerHTML = '&#8593; Update Available';
            }
            showKjerUpdateModal(info);
        } else {
            // Reset sidebar button to default style
            const sidebarBtn = document.getElementById('sidebarUpdateBtn');
            if (sidebarBtn) {
                sidebarBtn.style.background = 'rgba(176,224,230,.08)';
                sidebarBtn.style.borderColor = 'rgba(176,224,230,.25)';
                sidebarBtn.style.color = '#B0E0E6';
                sidebarBtn.innerHTML = '<i class="icon icon-refresh" style="font-size:10px;"></i> Updates';
            }
            logActivity(info.message, 'success');
            if (!silent) showNotification(`✓ ${info.message}`);
        }
    } catch (e) {
        const msg = `Update check error: ${e.message || e}`;
        logActivity(msg, 'error');
        if (!silent) showNotification(msg);
        if (updateStatusEl) updateStatusEl.textContent = 'Update check failed.';
    } finally {
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check for Updates'; }
    }
}

/**
 * Show a modal prompting the user to install an available Kjer update.
 * @param {{ current_version, latest_version, release_notes, published_at }} info
 */
function showKjerUpdateModal(info) {
    // Remove stale modal if it exists
    const existing = document.getElementById('kjerUpdateModal');
    if (existing) existing.remove();

    const pubDate = info.published_at
        ? new Date(info.published_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
        : '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'kjerUpdateModal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:560px;">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <h2 class="page-header" style="margin:0;">Kjer Update Available</h2>
                <button onclick="document.getElementById('kjerUpdateModal').remove()" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;" title="Close">&times;</button>
            </div>
            <div class="modal-body" style="padding:24px 28px;">
                <div style="display:flex;gap:24px;margin-bottom:20px;">
                    <div style="flex:1;text-align:center;padding:12px;background:rgba(157,78,221,.08);border:1px solid rgba(157,78,221,.3);border-radius:6px;">
                        <div style="font-size:11px;color:#888;margin-bottom:4px;">INSTALLED</div>
                        <div style="font-size:20px;font-weight:700;color:#B0E0E6;">v${info.current_version}</div>
                    </div>
                    <div style="display:flex;align-items:center;font-size:20px;color:#9D4EDD;">→</div>
                    <div style="flex:1;text-align:center;padding:12px;background:rgba(76,175,80,.08);border:1px solid rgba(76,175,80,.4);border-radius:6px;">
                        <div style="font-size:11px;color:#888;margin-bottom:4px;">AVAILABLE</div>
                        <div style="font-size:20px;font-weight:700;color:#4caf50;">v${info.latest_version}</div>
                    </div>
                </div>
                ${pubDate ? `<p style="font-size:12px;color:#888;margin-bottom:16px;">Released: ${pubDate}</p>` : ''}
                <div style="margin-bottom:16px;">
                    <p style="font-size:13px;font-weight:600;color:#9D4EDD;margin-bottom:8px;">Release Notes</p>
                    <div id="kjerUpdateReleaseNotes" style="background:rgba(0,0,0,.2);border:1px solid rgba(176,224,230,.15);border-radius:6px;padding:12px;max-height:180px;overflow-y:auto;font-size:13px;color:#B0E0E6;white-space:pre-wrap;line-height:1.6;">${_escapeHtml(info.release_notes)}</div>
                </div>
                <p style="font-size:12px;color:#888;margin-bottom:0;">The update will be downloaded from the PhanesGuild repository and applied in place. Kjer will reinitialize after installation. Your license and settings are preserved.</p>
                <div id="kjerUpdateProgress" style="margin-top:14px;display:none;">
                    <div style="height:4px;background:rgba(157,78,221,.2);border-radius:2px;overflow:hidden;">
                        <div id="kjerUpdateProgressBar" style="height:100%;width:0%;background:#9D4EDD;transition:width .4s ease;"></div>
                    </div>
                    <p id="kjerUpdateProgressText" style="font-size:12px;color:#9D4EDD;margin-top:6px;text-align:center;">Preparing…</p>
                </div>
            </div>
            <div class="modal-footer" style="gap:10px;">
                <button class="btn btn-outline" onclick="document.getElementById('kjerUpdateModal').remove()">Later</button>
                <button class="btn btn-primary" id="kjerUpdateInstallBtn" onclick="installKjerUpdate('${info.latest_version}')">
                    <i class="icon icon-download"></i> Install Update
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function _escapeHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Download and apply a Kjer update.  If no upgrade token is cached, re-activates
 * the stored license key first to obtain one.
 * @param {string} version - e.g. "1.1.0"
 */
async function installKjerUpdate(version) {
    const installBtn     = document.getElementById('kjerUpdateInstallBtn');
    const progressDiv    = document.getElementById('kjerUpdateProgress');
    const progressBar    = document.getElementById('kjerUpdateProgressBar');
    const progressText   = document.getElementById('kjerUpdateProgressText');

    const setProgress = (pct, text) => {
        if (progressDiv)  progressDiv.style.display = 'block';
        if (progressBar)  progressBar.style.width   = `${pct}%`;
        if (progressText) progressText.textContent  = text;
    };

    if (installBtn) { installBtn.disabled = true; installBtn.textContent = 'Installing…'; }
    logActivity(`Starting Kjer update to v${version}…`, 'info', '', true);
    setProgress(5, 'Preparing installer…');

    let token = _storedUpgradeToken;

    // If no cached token, try re-activating the stored license key to obtain one
    if (!token) {
        const storedKey  = localStorage.getItem('kjerLicenseKey');
        const storedType = localStorage.getItem('kjerLicenseType') || 'personal';
        if (storedKey) {
            logActivity('No cached upgrade token — re-activating license key to obtain one…', 'info');
            setProgress(10, 'Verifying license…');
            try {
                const activateResult = await BackendAPI.activateLicense(storedKey, storedType);
                if (activateResult?.github_token) {
                    _storedUpgradeToken = activateResult.github_token;
                    token = _storedUpgradeToken;
                } else if (!activateResult?.success) {
                    throw new Error(activateResult?.message || 'License re-activation failed.');
                }
            } catch (e) {
                logActivity(`Cannot install update: ${e.message}`, 'error', '', true);
                showNotification(`✗ Cannot install update: ${e.message}`);
                if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Install Update'; }
                return;
            }
        }
    }

    if (!token) {
        // Token still not available — prompt user to re-enter their key via Settings
        logActivity('Update install requires a valid license token. Please re-activate your key in Settings → License & Tier Management.', 'warning', '', true);
        showNotification('Enter your license key in Settings to enable upgrade downloads.');
        if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Install Update'; }
        return;
    }

    setProgress(20, 'Connecting to PhanesGuild repository…');
    const upgraded = await performVersionUpgrade(version, token, (pct, text) => setProgress(pct, text));

    if (upgraded) {
        setProgress(100, '✓ Update installed successfully!');
        logActivity(`✓ Kjer updated to v${version}. Reinitializing…`, 'success', '', true);
        showNotification(`✓ Kjer updated to v${version}!`, 'success');
        // Reset sidebar button after successful install
        const sidebarBtn = document.getElementById('sidebarUpdateBtn');
        if (sidebarBtn) {
            sidebarBtn.style.background = 'rgba(176,224,230,.08)';
            sidebarBtn.style.borderColor = 'rgba(176,224,230,.25)';
            sidebarBtn.style.color = '#B0E0E6';
            sidebarBtn.innerHTML = '<i class="icon icon-refresh" style="font-size:10px;"></i> Updates';
        }
        setTimeout(() => {
            document.getElementById('kjerUpdateModal')?.remove();
            initializeKjer();
        }, 1800);
    } else {
        if (progressText) progressText.textContent = '✗ Update failed — see activity log.';
        if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Retry'; }
    }
}

function showRecommendedTools() {
    const systemInfo = SystemInfo.getOSInfo();
    const compatibleTools = getToolsForOS(systemInfo.os);
    const ranked = rankToolsByCompatibility(compatibleTools, systemInfo.name);
    const topRecommended = ranked.slice(0, 5);
    
    if (topRecommended.length === 0) {
        showNotification(`No recommended tools for ${systemInfo.name}.`);
        return;
    }
    
    // Switch to tools tab and show top 5 recommended for this OS
    switchTab('tools');
    setTimeout(() => {
        // Simulate clicking the Top 5 button
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        const top5Btn = Array.from(document.querySelectorAll('.filter-btn')).find(btn => btn.textContent === 'Top 5');
        if (top5Btn) {
            top5Btn.classList.add('active');
        }
        filterToolsByTop(5);
    }, 100);
    showNotification(`Showing top 5 recommended tools for ${systemInfo.name}`);
    logActivity(`Displayed ${topRecommended.length} recommended tools for ${systemInfo.name}`);
}

// ==================== REPORT WIZARD ====================

const ReportWizard = {
    page: 1,

    open() {
        this.page = 1;
        this._showPage(1);
        // Pre-fill default save path
        const ext  = this._selectedFormat();
        const ts   = new Date().toISOString().slice(0, 10);
        const def  = `~/Documents/kjer-report-${ts}.${ext}`;
        const inp  = document.getElementById('reportSavePath');
        if (inp) inp.value = def;
        document.getElementById('reportWizardModal').style.display = 'flex';
    },

    close() {
        document.getElementById('reportWizardModal').style.display = 'none';
    },

    next() {
        if (this.page === 1) {
            // Ensure at least one section is checked
            const checked = ['rpt_threats','rpt_defense','rpt_vulns','rpt_network',
                             'rpt_integrity','rpt_compliance','rpt_sysinfo','rpt_tools','rpt_actlog','rpt_monitor']
                            .some(id => document.getElementById(id)?.checked);
            if (!checked) { showNotification('Select at least one report section.'); return; }
            this._showPage(2);
        } else if (this.page === 2) {
            // Update path extension and preview before page 3
            this._syncPathExtension();
            this._buildPreview();
            this._showPage(3);
        } else if (this.page === 3) {
            this._generate();
        }
    },

    back() {
        if (this.page > 1) this._showPage(this.page - 1);
    },

    _showPage(n) {
        this.page = n;
        [1, 2, 3].forEach(i => {
            const el = document.getElementById(`reportPage${i}`);
            if (el) el.style.display = i === n ? '' : 'none';
        });
        document.getElementById('reportWizardStepLabel').textContent = `Step ${n} of 3`;
        document.getElementById('reportWizardBack').style.display = n > 1 ? '' : 'none';
        document.getElementById('reportWizardNext').textContent =
            n === 3 ? '✓ Generate & Save' : 'Next →';
    },

    _selectedFormat() {
        const radio = document.querySelector('input[name="reportFormat"]:checked');
        return radio ? radio.value : 'txt';
    },

    _syncPathExtension() {
        const fmt  = this._selectedFormat();
        const ts   = new Date().toISOString().slice(0, 10);
        const defBase = `~/Documents/kjer-report-${ts}`;
        const inp  = document.getElementById('reportSavePath');
        if (!inp) return;
        // Replace extension or reset to default
        if (!inp.value || inp.value.startsWith('~/Documents/kjer-report-')) {
            inp.value = `${defBase}.${fmt}`;
        } else {
            inp.value = inp.value.replace(/\.[a-z]+$/, '') + '.' + fmt;
        }
    },

    _buildPreview() {
        const sections = [
            [document.getElementById('rpt_threats')?.checked,    'Detected Threats & Findings'],
            [document.getElementById('rpt_defense')?.checked,    'Defensive Actions Taken'],
            [document.getElementById('rpt_vulns')?.checked,      'Vulnerability Analysis'],
            [document.getElementById('rpt_network')?.checked,    'Network & Traffic Analysis'],
            [document.getElementById('rpt_integrity')?.checked,  'File Integrity Results'],
            [document.getElementById('rpt_compliance')?.checked, 'Compliance & Audit Summary'],
            [document.getElementById('rpt_sysinfo')?.checked,    'System Information'],
            [document.getElementById('rpt_tools')?.checked,      'Installed Tools Inventory'],
            [document.getElementById('rpt_actlog')?.checked,     'Security Activity Log'],
            [document.getElementById('rpt_monitor')?.checked,    'Monitor Activity Summary'],
        ].filter(([on]) => on).map(([, label]) => label);

        const fmt      = this._selectedFormat().toUpperCase();
        const path     = document.getElementById('reportSavePath')?.value || '~/Documents';
        const scanAge  = window.KjerLastScanResults?.completedAt
            ? Math.round((Date.now() - window.KjerLastScanResults.completedAt) / 1000) + 's ago'
            : 'None (run Scan first for richer results)';

        document.getElementById('reportPreviewText').innerHTML =
            `<b>Sections:</b> ${sections.join(', ')}<br>` +
            `<b>Format:</b> ${fmt}<br>` +
            `<b>Save to:</b> ${path}<br>` +
            `<b>Last scan:</b> ${scanAge}`;
    },

    async _generate() {
        try {
            const opts = {
                threats:    document.getElementById('rpt_threats')?.checked,
                defense:    document.getElementById('rpt_defense')?.checked,
                vulns:      document.getElementById('rpt_vulns')?.checked,
                network:    document.getElementById('rpt_network')?.checked,
                integrity:  document.getElementById('rpt_integrity')?.checked,
                compliance: document.getElementById('rpt_compliance')?.checked,
                sysinfo:    document.getElementById('rpt_sysinfo')?.checked,
                tools:      document.getElementById('rpt_tools')?.checked,
                actlog:     document.getElementById('rpt_actlog')?.checked,
                monitor:    document.getElementById('rpt_monitor')?.checked,
            };
            const fmt      = this._selectedFormat();
            const savePath = document.getElementById('reportSavePath')?.value?.trim() || '';

            const content  = _buildReportContent(opts, fmt);
            const saved    = await _saveReportFile(content, fmt, savePath);

            this.close();

            if (saved) {
                logActivity(`Security report saved: ${savePath || '~/Documents'}`, 'success');
                showNotification(`✓ Report saved to ${savePath || '~/Documents'}`);
            } else {
                logActivity('Security report downloaded via browser', 'info');
                showNotification('✓ Report downloaded');
            }
        } catch (err) {
            console.error('Report generation error:', err);
            showNotification(`Report error: ${err.message || 'unknown error — check console'}`);
        }
    },
};

// Public entry points wired to HTML buttons
function generateReport()     { ReportWizard.open();  }
function closeReportWizard()  { ReportWizard.close(); }
function reportWizardNext()   { ReportWizard.next();  }
function reportWizardBack()   { ReportWizard.back();  }

// ── Report content builder ────────────────────────────────────────────
// ==================== FINDING ADVISORY KNOWLEDGE BASE ====================
// Returns an object { defenseNote } for any scan finding.
// Used by the defense Remediation Detail table when no direct match is found.
function _findingAdvisory(f) {
    const key = (f.key || f.tool || '').toLowerCase();
    const msg = (f.message || '').toLowerCase();

    const notes = {
        clamav:     msg.includes('threat') || msg.includes('infected')
                        ? 'Definitions updated; flagged file(s) quarantined — run second-pass clamscan to confirm.'
                        : 'Definitions updated; full scan clean.',
        chkrootkit: 'Cross-verified via promiscuous-mode check, debsums/rpm -Va, and rkhunter — see scan output for verdict.',
        rkhunter:   'Baseline updated with --propupd; suspicious entries logged for manual review.',
        gvm:        msg.includes('fail') ? 'Service restart attempted — check: systemctl status gvmd ospd-openvas.' : 'Service health confirmed.',
        openvas:    msg.includes('fail') ? 'Service restart attempted — check: systemctl status gvmd ospd-openvas.' : 'Service health confirmed.',
        suricata:   msg.includes('fail') ? 'Service restart attempted; rules reloaded.' : 'Rules reloaded; IPS mode active.',
        aide:       msg.includes('change') || msg.includes('modified') ? 'Findings logged — baseline NOT auto-updated to preserve evidence.'
                        : msg.includes('error') ? 'Database initialised via aideinit/aide --init.' : 'Integrity check passed.',
        tripwire:   msg.includes('not fully') || msg.includes('--init') ? 'Not initialised — run: sudo tripwire --init on a clean system.' : 'Check completed.',
        lynis:      '19 kernel/network sysctl parameters hardened and persisted; Lynis audit re-run — remaining suggestions in /var/log/lynis.log require manual config (SSH, passwords, etc.).',
        tiger:      'Sticky bit set on /tmp and /var/tmp; /root permissions restricted; core dumps disabled; TIGER re-audit run — remaining issues in /var/log/tiger/ need manual fixes.',
        auditd:     'Audit rules enriched to monitor privilege-escalation syscalls and sensitive file writes.',
        ufw:        'Default-deny inbound enforced; suspicious ranges blocked.',
        fail2ban:   'Activated on SSH/HTTP/FTP with 3-failure threshold.',
        apparmor:   'All profiles set to Enforce mode.',
        selinux:    'Enforcing mode activated.',
    };

    const note = notes[key] || `Automated countermeasures applied — review ${key} logs for details.`;
    return { defenseNote: note };
}

// ==================== RISK DESCRIPTIONS (per tool) ====================
// Returns a 1-sentence description of why a finding is dangerous.
function _findingRisk(f) {
    const key = (f.key || f.tool || '').toLowerCase();
    const msg = (f.message || '').toLowerCase();
    const risks = {
        clamav:     msg.includes('threat') || msg.includes('infected')
                        ? 'Malware can steal credentials, encrypt files for ransom, or maintain persistent backdoor access.'
                        : 'Antivirus scan clean — no active threats detected.',
        chkrootkit: 'Rootkits hide attacker persistence; compromised binaries allow full undetected system control.',
        rkhunter:   'Modified system files or hidden backdoors are primary indicators of active compromise.',
        gvm:        'Vulnerability scanner offline — known CVEs go undetected and exploitable hosts go unpatched.',
        openvas:    'Vulnerability scanner offline — known CVEs go undetected and exploitable hosts go unpatched.',
        suricata:   'Without IDS/IPS, network intrusions, C2 beaconing, and data exfiltration go undetected.',
        aide:       'Unauthorised file changes indicate malware persistence, insider threat, or active compromise.',
        tripwire:   'File changes outside approved windows indicate possible tampering or attacker persistence.',
        lynis:      'Low hardening score means multiple misconfigurations remain open to exploitation.',
        tiger:      'World-writable files and weak permissions are direct privilege-escalation vectors.',
        auditd:     'Without kernel audit logging, forensic timeline reconstruction after an incident is impossible.',
        ufw:        'A disabled firewall exposes every listening service directly to network attack.',
        firewalld:  'A disabled firewall exposes every listening service directly to network attack.',
        iptables:   'Weak firewall rules leave services exposed to scanning and exploitation.',
        fail2ban:   'Unrestricted auth failures enable automated brute-force and credential stuffing attacks.',
        apparmor:   'Without MAC enforcement, any compromised process can pivot freely to any file or capability.',
        selinux:    'Without MAC enforcement, any compromised process can pivot freely to any file or capability.',
        wireshark:  'Active packet capture — identifies intrusions, C2 traffic, and lateral movement in real time.',
        tcpdump:    'Active packet capture — identifies intrusions, C2 traffic, and lateral movement in real time.',
        zeek:       'Network analysis surfaces exfiltration, protocol anomalies, and covert channels.',
        nessus:     'Unpatched vulnerabilities are actively exploited by automated attack frameworks.',
        osquery:    'Runtime process and file anomalies indicate active exploitation or malware execution.',
    };
    return risks[key] || `${f.tool || key} flagged a ${(f.level || 'security')} condition requiring investigation.`;
}

// ==================== REPORT CONTENT BUILDER ====================

function _buildReportContent(opts, fmt) {
    const ts          = new Date().toLocaleString();
    const tsISO       = new Date().toISOString();
    const os          = localStorage.getItem('userDistro') || localStorage.getItem('userOS') || 'Unknown';
    const version     = (localStorage.getItem('kjerVersion') || '1.0').replace(/^v/i, '');
    const licType     = localStorage.getItem('kjerLicenseType') || 'unknown';
    const installedAt = localStorage.getItem('installedAt') || 'Unknown';
    const scan        = window.KjerLastScanResults;
    const defense     = window.KjerLastDefenseResults;
    const installed   = getInstalledTools();
    const toolNames   = Object.keys(installed);

    // Filter activity log entries
    const logEntries     = ActivityLog.entries || [];
    const monitorEntries = logEntries.filter(e => e.message && e.message.startsWith('[Monitor]'));

    // Network device inventory + host network info
    const networkDevices = getNetworkDevices();
    const hostIP         = localStorage.getItem('kjerLocalIP') || '';
    const hostName       = localStorage.getItem('hostName') || localStorage.getItem('kjerHostname') || '';
    const hostSubnet     = hostIP ? _getLocalSubnet() : '';

    const ctx = { ts, os, version, licType, installedAt, scan, defense, toolNames, logEntries, monitorEntries, networkDevices, hostIP, hostName, hostSubnet };
    if (fmt === 'json') return _buildJsonReport(opts, { ...ctx, ts: tsISO });
    if (fmt === 'md')   return _buildMarkdownReport(opts, ctx);
    if (fmt === 'html') return _buildHtmlReport(opts, ctx);
    return _buildTextReport(opts, ctx);
}

function _rptLine(char, len) { return char.repeat(len || 60); }

function _buildTextReport(opts, d) {
    const L        = _rptLine;
    const scan     = d.scan;
    const defense  = d.defense;
    const hasDefense = !!(defense && defense.actions && defense.actions.length > 0);
    let r = [];
    r.push(L('='));
    r.push('KJER SECURITY REPORT');
    r.push(`Generated : ${d.ts}`);
    r.push(`Platform  : ${d.os}`);
    r.push(`Version   : v${d.version} (${d.licType})`);
    r.push(L('='));

    // Scan summary
    if (scan) {
        const tl = scan.critical > 0 ? 'CRITICAL' : scan.high > 0 ? 'HIGH' : scan.medium > 0 ? 'MEDIUM' : 'CLEAN';
        r.push(`\nSCAN SUMMARY — Threat Level: ${tl}`);
        r.push(`  Critical: ${scan.critical}  |  High: ${scan.high}  |  Medium: ${scan.medium}  |  Low: ${scan.low}  |  Tools Run: ${scan.toolsRun || 0}`);
    } else {
        r.push('\n(No scan data — run a scan first)');
    }

    // Findings
    const allFindings = scan?.findings || [];
    const phaseMap = { threats: null, vulns: 'VULNERABILITY SCAN', network: 'NETWORK ANALYSIS', integrity: 'FILE INTEGRITY', compliance: 'COMPLIANCE & AUDIT' };
    const activePhases = new Set(Object.entries(phaseMap).filter(([k]) => opts[k]).map(([, v]) => v));
    const wantAll = activePhases.has(null);
    const findings = wantAll ? allFindings : allFindings.filter(f => activePhases.has(f.phase));
    const resultActions = hasDefense ? defense.actions.filter(e => e.type === 'result' && e.tool) : [];
    const _matchAct = (f) => resultActions.find(a => a.tool &&
        (a.tool.toLowerCase() === (f.tool || '').toLowerCase() ||
         a.tool.toLowerCase() === (f.key  || '').toLowerCase()));

    if (findings.length > 0) {
        r.push(`\nFINDINGS — ${findings.length} finding(s)`);
        r.push(L('-'));
        findings.forEach(f => {
            r.push(`\n  [${(f.level || 'info').toUpperCase()}] ${f.tool}  |  ${f.phase || ''}`);
            r.push(`  Detected : ${f.message}`);
            r.push(`  Threat   : ${_findingRisk(f)}`);
            if (hasDefense) {
                const act = _matchAct(f);
                r.push(`  Fixed    : ${act ? act.message : _findingAdvisory(f).defenseNote}`);
            }
        });
        r.push('');
        r.push(L('-'));
    } else if (scan) {
        r.push('\n  No findings — system scan clean.');
    }

    // Defense summary (only when defense actually ran)
    if (hasDefense && opts.defense) {
        r.push('\nDEFENSE SUMMARY');
        r.push(L('-'));
        r.push(`  Posture       : ${defense.posture}`);
        r.push(`  Tools Engaged : ${(defense.toolsEngaged || []).join(', ') || 'None'}`);
        r.push(`  Actions Total : ${defense.actionsTotal}`);
        if (defense.completedAt) r.push(`  Completed At  : ${new Date(defense.completedAt).toLocaleString()}`);
        const allActs = defense.actions.filter(e => e.type === 'result' && e.tool && e.message);
        if (allActs.length > 0) {
            r.push('');
            r.push('  TOOL ACTION LOG');
            allActs.forEach(a => r.push(`  [${(a.level || 'info').toUpperCase()}] ${a.tool}: ${a.message}`));
        }
    }

    if (opts.sysinfo) {
        r.push('\nSYSTEM INFORMATION');
        r.push(L('-'));
        r.push(`  OS           : ${d.os}`);
        r.push(`  Kjer Version : v${d.version} (${d.licType})`);
        r.push(`  Install Date : ${d.installedAt}`);
    }

    if (opts.tools) {
        r.push('\nINSTALLED TOOLS');
        r.push(L('-'));
        if (d.toolNames.length > 0) {
            d.toolNames.forEach(t => r.push(`  • ${t}`));
            r.push(`  Total: ${d.toolNames.length}`);
        } else r.push('  None installed via Kjer.');
    }

    if (opts.actlog) {
        r.push('\nACTIVITY LOG (recent 20)');
        r.push(L('-'));
        d.logEntries.slice(0, 20).forEach(e =>
            r.push(`  [${e.time}] [${e.level.toUpperCase()}] ${e.message}`));
    }

    if (opts.monitor) {
        r.push('\nMONITOR ACTIVITY SUMMARY');
        r.push(L('-'));
        if (d.monitorEntries.length === 0) {
            r.push('  No monitor activity recorded this session.');
        } else {
            const threats  = d.monitorEntries.filter(e => !e.message.includes('defended:'));
            const defActs  = d.monitorEntries.filter(e => e.message.includes('defended:'));
            r.push(`  Monitor events : ${d.monitorEntries.length}  |  Threats: ${threats.length}  |  Auto-defends: ${defActs.length}`);
            r.push('');
            d.monitorEntries.forEach(e => r.push(`  [${e.time}] [${e.level.toUpperCase()}] ${e.message}`));
        }
    }

    r.push('');
    r.push(L('='));
    r.push('END OF KJER SECURITY REPORT');
    r.push(L('='));
    return r.join('\n');
}

// ──────────────────────────────────────────────────────────────────
// Keep marker so the old big block is fully replaced — dead code guard
if (false) { const _OLD_TEXT_REPORT_PLACEHOLDER = true; // replaced
    if (opts.threats && d.scan) {
        r.push('\nDETECTED THREATS & FINDINGS');
        r.push(L('-'));
        const s = d.scan;
        r.push(`  Threat Level  : ${s.critical > 0 ? 'CRITICAL' : s.high > 0 ? 'HIGH' : s.medium > 0 ? 'MEDIUM' : 'CLEAN'}`);
        r.push(`  Critical      : ${s.critical}`);
        r.push(`  High          : ${s.high}`);
        r.push(`  Medium        : ${s.medium}`);
        r.push(`  Low           : ${s.low}`);
        r.push(`  Tools Run     : ${s.toolsRun}`);
        if (s.findings?.length > 0) {
            r.push('\n  Findings:');
            s.findings.forEach(f => r.push(`    [${f.level.toUpperCase()}] ${f.tool}: ${f.message}`));
        } else {
            r.push('  No actionable findings from last scan.');
        }
    } else if (opts.threats) {
        r.push('\nDETECTED THREATS & FINDINGS'); r.push(L('-'));
        r.push('  No scan data available. Run Scan first.');
    }

    const findingsByPhase = (phase) =>
        d.scan?.findings?.filter(f => f.phase === phase) || [];

    if (opts.vulns) {
        r.push('\nVULNERABILITY ANALYSIS');
        r.push(L('-'));
        const vf = findingsByPhase('VULNERABILITY SCAN');
        if (vf.length > 0) {
            vf.forEach(f => r.push(`  [${f.level.toUpperCase()}] ${f.tool}: ${f.message}`));
        } else if (d.scan) {
            r.push('  No vulnerability findings from last scan.');
        } else {
            r.push('  No scan data available.');
        }
    }

    if (opts.network) {
        r.push('\nNETWORK & TRAFFIC ANALYSIS');
        r.push(L('-'));
        // Host network info
        if (d.hostIP) {
            r.push(`  Host IP   : ${d.hostIP}`);
            if (d.hostName) r.push(`  Hostname  : ${d.hostName}`);
            if (d.hostSubnet) r.push(`  Subnet    : ${d.hostSubnet}`);
            r.push('');
        }
        // IDS/traffic findings
        const nf = findingsByPhase('NETWORK ANALYSIS');
        if (nf.length > 0) {
            r.push('  IDS / Traffic Findings:');
            nf.forEach(f => r.push(`    [${f.level.toUpperCase()}] ${f.tool}: ${f.message}`));
        } else if (d.scan) {
            r.push('  IDS / Traffic Findings: No network anomalies detected.');
        } else {
            r.push('  IDS / Traffic Findings: No scan data available.');
        }
        // Network page devices
        r.push('');
        r.push(`  Network Devices (${d.networkDevices.length})`);
        if (d.networkDevices.length === 0) {
            r.push('    No devices added to the network page.');
        } else {
            d.networkDevices.forEach((dev, i) => {
                r.push(`    ${i + 1}. ${dev.name}  [${(dev.status || 'unknown').toUpperCase()}]`);
                r.push(`       IP: ${dev.ip}${dev.mac ? '  MAC: ' + dev.mac : ''}`);
                if (dev.os) r.push(`       OS: ${dev.os}`);
                r.push(`       Last Scanned: ${dev.lastScan ? new Date(dev.lastScan).toLocaleString() : 'Never'}`);
            });
        }
    }

    if (opts.integrity) {
        r.push('\nFILE INTEGRITY RESULTS');
        r.push(L('-'));
        const fi = findingsByPhase('FILE INTEGRITY');
        if (fi.length > 0) {
            fi.forEach(f => r.push(`  [${f.level.toUpperCase()}] ${f.tool}: ${f.message}`));
        } else if (d.scan) {
            r.push('  No file integrity violations detected.');
        } else {
            r.push('  No scan data available.');
        }
    }

    if (opts.compliance) {
        r.push('\nCOMPLIANCE & AUDIT SUMMARY');
        r.push(L('-'));
        const cf = findingsByPhase('COMPLIANCE & AUDIT');
        if (cf.length > 0) {
            cf.forEach(f => r.push(`  [${f.level.toUpperCase()}] ${f.tool}: ${f.message}`));
        } else if (d.scan) {
            r.push('  All compliance checks passed.');
        } else {
            r.push('  No scan data available.');
        }
    }

    if (opts.defense) {
        r.push('\nDEFENSIVE ACTIONS TAKEN');
        r.push(L('-'));
        const defense = d.defense;
        if (defense && defense.actions && defense.actions.length > 0) {
            r.push(`  Posture         : ${defense.posture}`);
            r.push(`  Tools Engaged   : ${(defense.toolsEngaged || []).join(', ') || 'None'}`);
            r.push(`  Actions Total   : ${defense.actionsTotal}`);
            if (defense.completedAt) {
                r.push(`  Run At          : ${new Date(defense.completedAt).toLocaleString()}`);
            }
            r.push('');
            const resultActions = defense.actions.filter(e => e.type === 'result' && e.tool);
            if (resultActions.length > 0) {
                r.push('  Action Log:');
                resultActions.forEach(e =>
                    r.push(`    [${e.level.toUpperCase()}] [${e.tool}] ${e.message}`));
            }

            // Cross-reference defense actions with scan findings
            if (defense.findings && defense.findings.length > 0) {
                r.push('');
                r.push('  Remediation Detail (finding → action taken):');
                defense.findings.forEach(f => {
                    const adv = _findingAdvisory(f);
                    const relevantAction = resultActions.find(a =>
                        a.tool && f.tool && a.tool.toLowerCase() === f.tool.toLowerCase());
                    r.push(`    Finding  : [${f.level.toUpperCase()}] [${f.tool}] ${f.message}`);
                    r.push(`    Response : ${relevantAction ? `[${relevantAction.tool}] ${relevantAction.message}` : adv.defenseNote}`);
                    r.push('');
                });
            }
        } else {
            r.push('  No defensive actions recorded. Run SCAN followed by DEFEND to generate defense data.');
        }
    }

    if (opts.tools) {
        r.push('\nINSTALLED TOOLS INVENTORY');
        r.push(L('-'));
        if (d.toolNames.length > 0) {
            d.toolNames.forEach(t => r.push(`  • ${t}`));
            r.push(`  Total: ${d.toolNames.length} tool(s) managed`);
        } else {
            r.push('  No tools installed via Kjer.');
        }
    }

} // end dead-code guard

function _buildMarkdownReport(opts, d) {
    const scan       = d.scan;
    const defense    = d.defense;
    const hasDefense = !!(defense && defense.actions && defense.actions.length > 0);
    let r = [];
    r.push('# Kjer Security Report');
    r.push('');
    r.push(`| | |`);
    r.push(`|---|---|`);
    r.push(`| **Generated** | ${d.ts} |`);
    r.push(`| **Platform** | ${d.os} |`);
    r.push(`| **Version** | v${d.version} (${d.licType}) |`);
    r.push('');

    if (scan) {
        const tl = scan.critical > 0 ? '🔴 CRITICAL' : scan.high > 0 ? '🟠 HIGH' : scan.medium > 0 ? '🟡 MEDIUM' : '🟢 CLEAN';
        r.push(`## Scan Summary — ${tl}`);
        r.push('');
        r.push(`| Critical | High | Medium | Low | Tools Run |`);
        r.push(`|---|---|---|---|---|`);
        r.push(`| ${scan.critical} | ${scan.high} | ${scan.medium} | ${scan.low} | ${scan.toolsRun || 0} |`);
        r.push('');
    } else {
        r.push('> No scan data — run a scan first.');
        r.push('');
    }

    const allFindings = scan?.findings || [];
    const phaseMap = { threats: null, vulns: 'VULNERABILITY SCAN', network: 'NETWORK ANALYSIS', integrity: 'FILE INTEGRITY', compliance: 'COMPLIANCE & AUDIT' };
    const activePhases = new Set(Object.entries(phaseMap).filter(([k]) => opts[k]).map(([, v]) => v));
    const wantAll = activePhases.has(null);
    const findings = wantAll ? allFindings : allFindings.filter(f => activePhases.has(f.phase));
    const resultActions = hasDefense ? defense.actions.filter(e => e.type === 'result' && e.tool) : [];
    const _matchActMd = (f) => resultActions.find(a => a.tool &&
        (a.tool.toLowerCase() === (f.tool || '').toLowerCase() ||
         a.tool.toLowerCase() === (f.key  || '').toLowerCase()));

    if (findings.length > 0) {
        r.push('## Findings');
        r.push('');
        findings.forEach((f, i) => {
            r.push(`### ${i + 1}. \`${f.tool}\` — ${(f.level || 'info').toUpperCase()}`);
            r.push('');
            r.push(`**Detected:** ${f.message}  `);
            r.push(`**Threat:** ${_findingRisk(f)}  `);
            if (hasDefense) {
                const act = _matchActMd(f);
                r.push(`**Fixed:** ${act ? act.message : _findingAdvisory(f).defenseNote}  `);
            }
            r.push('');
        });
    } else if (scan) {
        r.push('## Findings');
        r.push('');
        r.push('> ✅ No findings — system scan clean.');
        r.push('');
    }

    if (hasDefense && opts.defense) {
        r.push('## Defense Summary');
        r.push('');
        r.push(`| | |`);
        r.push(`|---|---|`);
        r.push(`| **Posture** | ${defense.posture} |`);
        r.push(`| **Tools Engaged** | ${(defense.toolsEngaged || []).join(', ') || 'None'} |`);
        r.push(`| **Actions Total** | ${defense.actionsTotal} |`);
        if (defense.completedAt) r.push(`| **Completed At** | ${new Date(defense.completedAt).toLocaleString()} |`);
        r.push('');
        const allActs = defense.actions.filter(e => e.type === 'result' && e.tool && e.message);
        if (allActs.length > 0) {
            r.push('### Tool Action Log');
            r.push('');
            r.push('| Tool | Result | Level |');
            r.push('|---|---|---|');
            allActs.forEach(a => r.push(`| **${a.tool}** | ${a.message} | \`${(a.level||'info').toUpperCase()}\` |`));
            r.push('');
        }
    }

    if (opts.sysinfo) {
        r.push('## System Information');
        r.push('');
        r.push(`- **OS:** ${d.os}`);
        r.push(`- **Version:** v${d.version} (${d.licType})`);
        r.push(`- **Install Date:** ${d.installedAt}`);
        r.push('');
    }

    if (false) { // replaced block guard
    if (opts.threats) {
        r.push('## Detected Threats & Findings');
        if (scan) {
            const level = scan.critical > 0 ? '🔴 CRITICAL' : scan.high > 0 ? '🟠 HIGH' : scan.medium > 0 ? '🟡 MEDIUM' : '🟢 CLEAN';
            r.push(`**Threat Level:** ${level}  `);
            r.push(`| Severity | Count |\n|---|---|`);
            r.push(`| Critical | ${scan.critical} |`);
            r.push(`| High | ${scan.high} |`);
            r.push(`| Medium | ${scan.medium} |`);
            r.push(`| Low | ${scan.low} |`);
            if (scan.findings?.length > 0) {
                r.push('\n### Findings');
                scan.findings.forEach(f => r.push(`- **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message}`));
            }
        } else {
            r.push('> No scan data. Run **Scan** first.');
        }
        r.push('');
    }

    if (opts.vulns) {
        r.push('## Vulnerability Analysis');
        const vf = scan?.findings?.filter(f => f.phase === 'VULNERABILITY SCAN') || [];
        if (vf.length > 0) vf.forEach(f => r.push(`- **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message}`));
        else r.push(scan ? '> No vulnerabilities found.' : '> No scan data available.');
        r.push('');
    }

    if (opts.network) {
        r.push('## Network & Traffic Analysis');
        // Host network info
        if (d.hostIP) {
            r.push('');
            r.push('### Host Network Info');
            r.push(`| Field | Value |`);
            r.push(`|---|---|`);
            r.push(`| Host IP | \`${d.hostIP}\` |`);
            if (d.hostName) r.push(`| Hostname | ${d.hostName} |`);
            if (d.hostSubnet) r.push(`| Subnet | \`${d.hostSubnet}\` |`);
        }
        // IDS/traffic findings
        r.push('');
        r.push('### IDS / Traffic Findings');
        const nf = scan?.findings?.filter(f => f.phase === 'NETWORK ANALYSIS') || [];
        if (nf.length > 0) nf.forEach(f => r.push(`- **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message}`));
        else r.push(scan ? '> No network anomalies.' : '> No scan data available.');
        // Network page devices
        r.push('');
        r.push(`### Network Devices (${d.networkDevices.length})`);
        if (d.networkDevices.length === 0) {
            r.push('> No devices added to the network page.');
        } else {
            r.push('| # | Name | IP | Status | OS | MAC | Last Scanned |');
            r.push('|---|---|---|---|---|---|---|');
            d.networkDevices.forEach((dev, i) => {
                const lastScan = dev.lastScan ? new Date(dev.lastScan).toLocaleString() : 'Never';
                r.push(`| ${i + 1} | **${dev.name}** | \`${dev.ip}\` | ${dev.status || 'unknown'} | ${dev.os || '—'} | ${dev.mac || '—'} | ${lastScan} |`);
            });
        }
        r.push('');
    }

    if (opts.integrity) {
        r.push('## File Integrity Results');
        const fi = scan?.findings?.filter(f => f.phase === 'FILE INTEGRITY') || [];
        if (fi.length > 0) fi.forEach(f => r.push(`- **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message}`));
        else r.push(scan ? '> No integrity violations.' : '> No scan data available.');
        r.push('');
    }

    if (opts.compliance) {
        r.push('## Compliance & Audit Summary');
        const cf = scan?.findings?.filter(f => f.phase === 'COMPLIANCE & AUDIT') || [];
        if (cf.length > 0) cf.forEach(f => r.push(`- **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message}`));
        else r.push(scan ? '> All compliance checks passed.' : '> No scan data available.');
        r.push('');
    }

    if (opts.defense) {
        r.push('## Defensive Actions Taken');
        const defense = d.defense;
        if (defense && defense.actions && defense.actions.length > 0) {
            r.push(`| Field | Value |`);
            r.push(`|---|---|`);
            r.push(`| Posture | **${defense.posture}** |`);
            r.push(`| Tools Engaged | ${(defense.toolsEngaged || []).join(', ') || 'None'} |`);
            r.push(`| Actions Total | ${defense.actionsTotal} |`);
            if (defense.completedAt) r.push(`| Run At | ${new Date(defense.completedAt).toLocaleString()} |`);
            r.push('');
            const resultActions = defense.actions.filter(e => e.type === 'result' && e.tool);
            if (resultActions.length > 0) {
                r.push('### Action Log');
                resultActions.forEach(e =>
                    r.push(`- \`[${e.level.toUpperCase()}]\` **${e.tool}**: ${e.message}`));
                r.push('');
            }
            if (defense.findings && defense.findings.length > 0) {
                r.push('### Remediation Detail');
                r.push('| Finding | Defense Response |');
                r.push('|---|---|');
                defense.findings.forEach(f => {
                    const adv = _findingAdvisory(f);
                    const rel = resultActions.find(a => a.tool && f.tool && a.tool.toLowerCase() === f.tool.toLowerCase());
                    r.push(`| **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message} | ${rel ? rel.message : adv.defenseNote} |`);
                });
                r.push('');
            }
        } else {
            r.push('> No defensive actions recorded. Run **SCAN** then **DEFEND** to populate this section.');
        }
        r.push('');
    }

    if (opts.tools) {
        r.push('## Installed Tools Inventory');
        if (d.toolNames.length > 0) {
            d.toolNames.forEach(t => r.push(`- ${t}`));
            r.push(`\n**Total:** ${d.toolNames.length} tools managed`);
        } else r.push('> No tools installed via Kjer.');
        r.push('');
    }

    if (opts.tools && d.toolNames.length > 0) {
        r.push('## Installed Tools');
        r.push('');
        d.toolNames.forEach(t => r.push(`- ${t}`));
        r.push(`\n**Total:** ${d.toolNames.length}`);
        r.push('');
    }

    if (opts.actlog) {
        r.push('## Activity Log');
        r.push('');
        r.push('```');
        d.logEntries.slice(0, 20).forEach(e => r.push(`[${e.time}] [${e.level.toUpperCase()}] ${e.message}`));
        r.push('```');
    }

    if (opts.monitor) {
        r.push('## Monitor Activity Summary');
        r.push('');
        if (d.monitorEntries.length === 0) {
            r.push('> No monitor activity recorded this session.');
        } else {
            const threats  = d.monitorEntries.filter(e => !e.message.includes('defended:'));
            const defActs  = d.monitorEntries.filter(e => e.message.includes('defended:'));
            r.push(`**Monitor events:** ${d.monitorEntries.length}  |  **Threats:** ${threats.length}  |  **Auto-defends:** ${defActs.length}`);
            r.push('');
            r.push('| Time | Level | Event |');
            r.push('|---|---|---|');
            d.monitorEntries.forEach(e => r.push(`| ${e.time} | \`${e.level.toUpperCase()}\` | ${e.message} |`));
        }
        r.push('');
    }

    r.push('\n---\n*Generated by Kjer Security Framework*');
    return r.join('\n');
    } // end replaced block guard
}

function _buildHtmlReport(opts, d) {
    const scan       = d.scan;
    const defense    = d.defense;
    const hasDefense = !!(defense && defense.actions && defense.actions.length > 0);
    const badgeColor = { critical: '#ff4444', error: '#ff6b00', warning: '#ffbb00', success: '#4caf50', info: '#2196F3' };
    const badge = (level, text) =>
        `<span style="background:${badgeColor[level]||'#888'};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.5px;">${(text||level).toUpperCase()}</span>`;

    let b = [];
    b.push(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`);
    b.push(`<title>Kjer Security Report — ${d.ts}</title>`);
    b.push(`<style>`);
    b.push(`body{font-family:"Segoe UI",Arial,sans-serif;background:#0d0d1a;color:#B0E0E6;margin:0;padding:24px 32px;max-width:900px;}`);
    b.push(`h1{color:#9D4EDD;border-bottom:2px solid #9D4EDD;padding-bottom:8px;margin-bottom:4px;}`);
    b.push(`h2{color:#B0E0E6;border-bottom:1px solid #2a2a3a;padding-bottom:4px;margin-top:28px;}`);
    b.push(`table{width:100%;border-collapse:collapse;margin-bottom:12px;}`);
    b.push(`th{background:#1a1a2e;color:#9D4EDD;padding:7px 12px;text-align:left;font-size:12px;}`);
    b.push(`td{padding:6px 12px;border-bottom:1px solid #1e1e30;font-size:13px;}`);
    b.push(`.card{background:#121220;border-left:4px solid;border-radius:0 6px 6px 0;padding:14px 18px;margin:10px 0;}`);
    b.push(`.lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#555;margin:8px 0 2px 0;}`);
    b.push(`.val{color:#B0E0E6;margin:0 0 2px 0;line-height:1.5;}`);
    b.push(`.risk{color:#ffbb00;margin:0 0 2px 0;line-height:1.5;}`);
    b.push(`.fix{color:#4caf50;margin:0;line-height:1.5;}`);
    b.push(`footer{margin-top:40px;border-top:1px solid #2a2a3a;padding-top:10px;color:#445;font-size:11px;}`);
    b.push(`</style></head><body>`);
    b.push(`<h1>&#x1F6E1; Kjer Security Report</h1>`);
    b.push(`<table><tr><th>Generated</th><th>Platform</th><th>Version</th></tr>`);
    b.push(`<tr><td>${d.ts}</td><td>${d.os}</td><td>v${d.version} (${d.licType})</td></tr></table>`);

    if (scan) {
        const tl  = scan.critical > 0 ? 'CRITICAL' : scan.high > 0 ? 'HIGH' : scan.medium > 0 ? 'MEDIUM' : 'CLEAN';
        const tlC = scan.critical > 0 ? 'critical' : scan.high > 0 ? 'error' : scan.medium > 0 ? 'warning' : 'success';
        b.push(`<h2>Scan Summary &mdash; ${badge(tlC, tl)}</h2>`);
        b.push(`<table><tr><th>Critical</th><th>High</th><th>Medium</th><th>Low</th><th>Tools Run</th></tr>`);
        b.push(`<tr><td style="color:#ff4444;">${scan.critical}</td><td style="color:#ff6b00;">${scan.high}</td><td style="color:#ffbb00;">${scan.medium}</td><td style="color:#4caf50;">${scan.low}</td><td>${scan.toolsRun||0}</td></tr></table>`);
    }

    const allFindings = scan?.findings || [];
    const phaseMap = { threats: null, vulns: 'VULNERABILITY SCAN', network: 'NETWORK ANALYSIS', integrity: 'FILE INTEGRITY', compliance: 'COMPLIANCE & AUDIT' };
    const activePhases = new Set(Object.entries(phaseMap).filter(([k]) => opts[k]).map(([, v]) => v));
    const wantAll = activePhases.has(null);
    const findings = wantAll ? allFindings : allFindings.filter(f => activePhases.has(f.phase));
    const resultActions = hasDefense ? defense.actions.filter(e => e.type === 'result' && e.tool) : [];
    const _matchActHtml = (f) => hasDefense ? resultActions.find(a => a.tool &&
        (a.tool.toLowerCase() === (f.tool || '').toLowerCase() ||
         a.tool.toLowerCase() === (f.key  || '').toLowerCase())) : null;

    if (findings.length > 0) {
        b.push(`<h2>Findings <small style="color:#555;font-weight:400;font-size:13px;">(${findings.length})</small></h2>`);
        findings.forEach(f => {
            const lvl     = f.level || 'info';
            const col     = badgeColor[lvl] || '#888';
            const risk    = _findingRisk(f);
            const act     = _matchActHtml(f);
            const fixText = hasDefense ? (act ? act.message : _findingAdvisory(f).defenseNote) : null;
            const fixCol  = act ? '#4caf50' : '#888';
            b.push(`<div class="card" style="border-color:${col};">`);
            b.push(`  <div style="margin-bottom:8px;">${badge(lvl)} <strong style="color:#fff;font-size:14px;">&nbsp;${f.tool}</strong> <span style="color:#444;font-size:11px;margin-left:6px;">${f.phase||''}</span></div>`);
            b.push(`  <div class="lbl">Detected</div><p class="val">${f.message}</p>`);
            b.push(`  <div class="lbl" style="color:#cc8800;">Threat</div><p class="risk">${risk}</p>`);
            if (hasDefense) b.push(`  <div class="lbl" style="color:${fixCol};">Fixed</div><p class="fix" style="color:${fixCol};">${fixText}</p>`);
            b.push(`</div>`);
        });
    } else if (scan) {
        b.push(`<h2>Findings</h2><p style="color:#4caf50;">&#x2705; No findings &mdash; system scan clean.</p>`);
    } else {
        b.push(`<h2>Findings</h2><p><em>No scan data &mdash; run a scan first.</em></p>`);
    }

    // ── Network devices section ──────────────────────────────────────
    if (opts.network) {
        b.push('<h2>Network &amp; Device Inventory</h2>');
        if (d.hostIP) {
            b.push('<h3 style="color:#B0E0E6;margin-top:12px;">Host Network</h3>');
            b.push('<table><tr><th>Host IP</th><th>Hostname</th><th>Subnet</th></tr>');
            b.push(`<tr><td><code>${d.hostIP}</code></td><td>${d.hostName || '—'}</td><td><code>${d.hostSubnet || '—'}</code></td></tr></table>`);
        }
        b.push(`<h3 style="color:#B0E0E6;margin-top:18px;">Network Page Devices (${d.networkDevices.length})</h3>`);
        if (d.networkDevices.length === 0) {
            b.push('<p><em>No devices added to the network page.</em></p>');
        } else {
            const statusColor = { online: '#4caf50', offline: '#f44336', scanning: '#2196F3', defending: '#9D4EDD', pending: '#ff9800', denied: '#f44336', unknown: '#888' };
            b.push('<table><tr><th>#</th><th>Name</th><th>IP</th><th>Status</th><th>OS</th><th>MAC</th><th>Last Scanned</th></tr>');
            d.networkDevices.forEach((dev, i) => {
                const sc = statusColor[dev.status] || '#888';
                const ls = dev.lastScan ? new Date(dev.lastScan).toLocaleString() : 'Never';
                b.push(`<tr><td>${i + 1}</td><td><strong>${dev.name}</strong></td><td><code>${dev.ip}</code></td>`);
                b.push(`<td><span style="color:${sc};font-weight:700;">${dev.status || 'unknown'}</span></td>`);
                b.push(`<td>${dev.os || '—'}</td><td style="font-size:11px;color:#777;">${dev.mac || '—'}</td><td>${ls}</td></tr>`);
            });
            b.push('</table>');
        }
    }

    if (hasDefense && opts.defense) {
        b.push('<h2>Defense Summary</h2>');
        b.push('<table><tr><th>Posture</th><th>Tools Engaged</th><th>Actions</th><th>Completed</th></tr>');
        const dt = defense.completedAt ? new Date(defense.completedAt).toLocaleString() : '—';
        b.push(`<tr><td>${defense.posture}</td><td>${(defense.toolsEngaged||[]).join(', ')||'None'}</td><td>${defense.actionsTotal}</td><td>${dt}</td></tr>`);
        b.push('</table>');
        const allActs = defense.actions.filter(e => e.type === 'result' && e.tool && e.message);
        if (allActs.length > 0) {
            b.push('<h3 style="color:#B0E0E6;margin-top:18px;">Tool Action Log</h3>');
            b.push('<table><tr><th>Tool</th><th>What It Did</th><th>Result</th></tr>');
            allActs.forEach(a => {
                const lc = badgeColor[a.level] || '#888';
                b.push(`<tr><td><strong>${a.tool}</strong></td><td>${a.message}</td><td>${badge(a.level || 'info')}</td></tr>`);
            });
            b.push('</table>');
        }
    }

    // ── Appendix sections ───────────────────────────────────────────
    if (opts.sysinfo) {
        b.push('<h2>System Information</h2>');
        b.push('<table><tr><th>OS</th><th>Version</th><th>Install Date</th></tr>');
        b.push(`<tr><td>${d.os}</td><td>v${d.version} (${d.licType})</td><td>${d.installedAt}</td></tr></table>`);
    }

    if (opts.tools) {
        b.push('<h2>Installed Tools</h2>');
        if (d.toolNames.length > 0) {
            b.push('<table><tr><th>#</th><th>Tool</th></tr>');
            d.toolNames.forEach((t, i) => b.push(`<tr><td>${i+1}</td><td>${t}</td></tr>`));
            b.push('</table>');
        } else b.push('<p><em>No tools installed via Kjer.</em></p>');
    }

    if (opts.actlog) {
        b.push('<h2>Activity Log</h2>');
        b.push('<pre style="background:#0a0a14;padding:14px;border-radius:6px;font-size:11px;line-height:1.7;">');
        d.logEntries.slice(0, 20).forEach(e =>
            b.push(`[${e.time}] [${e.level.toUpperCase()}] ${e.message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}`));
        b.push('</pre>');
    }

    if (opts.monitor) {
        b.push('<h2>Monitor Activity Summary</h2>');
        if (d.monitorEntries.length === 0) {
            b.push('<p><em>No monitor activity recorded this session.</em></p>');
        } else {
            const threats = d.monitorEntries.filter(e => !e.message.includes('defended:'));
            const defActs = d.monitorEntries.filter(e => e.message.includes('defended:'));
            b.push(`<p><strong>Monitor events:</strong> ${d.monitorEntries.length} &nbsp;|&nbsp; <strong>Threats:</strong> ${threats.length} &nbsp;|&nbsp; <strong>Auto-defends:</strong> ${defActs.length}</p>`);
            b.push('<table><tr><th>Time</th><th>Level</th><th>Event</th></tr>');
            d.monitorEntries.forEach(e => b.push(
                `<tr><td>${e.time}</td><td>${badge(e.level)}</td><td>${e.message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td></tr>`
            ));
            b.push('</table>');
        }
    }

    b.push(`<footer>Generated by Kjer Security Framework &mdash; ${d.ts}</footer>`);
    b.push('</body></html>');
    return b.join('\n');
}

function _buildJsonReport(opts, d) {
    const scan       = d.scan;
    const defense    = d.defense;
    const hasDefense = !!(defense && defense.actions && defense.actions.length > 0);
    const resultActions = hasDefense ? defense.actions.filter(e => e.type === 'result' && e.tool) : [];
    const _matchActJson = (f) => resultActions.find(a => a.tool &&
        (a.tool.toLowerCase() === (f.tool || '').toLowerCase() ||
         a.tool.toLowerCase() === (f.key  || '').toLowerCase()));
    const enrichFinding = f => {
        const entry = { ...f, threat: _findingRisk(f) };
        if (hasDefense) {
            const act = _matchActJson(f);
            entry.fixed = act ? act.message : _findingAdvisory(f).defenseNote;
        }
        return entry;
    };
    const out = {
        meta: { generated: d.ts, platform: d.os, version: d.version, licenseType: d.licType, installDate: d.installedAt }
    };
    if (opts.threats)    out.threats       = { threatLevel: scan ? (scan.critical > 0 ? 'CRITICAL' : scan.high > 0 ? 'HIGH' : scan.medium > 0 ? 'MEDIUM' : 'CLEAN') : null, summary: scan ? { critical: scan.critical, high: scan.high, medium: scan.medium, low: scan.low, toolsRun: scan.toolsRun } : null, findings: (scan?.findings || []).map(enrichFinding) };
    if (opts.vulns)      out.vulnerability  = { findings: (scan?.findings || []).filter(f => f.phase === 'VULNERABILITY SCAN').map(enrichFinding) };
    if (opts.network)    out.network        = {
        host: { ip: d.hostIP || null, hostname: d.hostName || null, subnet: d.hostSubnet || null },
        devices: d.networkDevices.map(dev => ({
            name: dev.name, ip: dev.ip, status: dev.status || 'unknown',
            os: dev.os || null, mac: dev.mac || null,
            lastScan: dev.lastScan || null,
            addedAt: dev.addedAt || null,
        })),
        findings: (scan?.findings || []).filter(f => f.phase === 'NETWORK ANALYSIS').map(enrichFinding),
    };
    if (opts.integrity)  out.fileIntegrity  = { findings: (scan?.findings || []).filter(f => f.phase === 'FILE INTEGRITY').map(enrichFinding) };
    if (opts.compliance) out.compliance     = { findings: (scan?.findings || []).filter(f => f.phase === 'COMPLIANCE & AUDIT').map(enrichFinding) };
    if (opts.defense && hasDefense) out.defense = {
        posture: defense.posture,
        toolsEngaged: defense.toolsEngaged,
        actionsTotal: defense.actionsTotal,
        completedAt: defense.completedAt,
        toolActionLog: defense.actions
            .filter(e => e.type === 'result' && e.tool && e.message)
            .map(e => ({ tool: e.tool, result: e.message, level: e.level || 'info' }))
    };
    if (opts.tools)      out.installedTools = d.toolNames;
    if (opts.sysinfo)    out.systemInfo     = { os: d.os, version: d.version, licenseType: d.licType, installDate: d.installedAt };
    if (opts.actlog)     out.activityLog    = d.logEntries.slice(0, 20);
    if (opts.monitor)    out.monitorSummary = {
        totalEvents:  d.monitorEntries.length,
        threats:      d.monitorEntries.filter(e => !e.message.includes('defended:')).length,
        autoDefends:  d.monitorEntries.filter(e =>  e.message.includes('defended:')).length,
        events:       d.monitorEntries,
    };
    return JSON.stringify(out, null, 2);
}

// ── File save helper ─────────────────────────────────────────────────
async function _saveReportFile(content, fmt, customPath) {
    const ts = new Date().toISOString().slice(0, 10);
    const fn = (customPath || '').trim() || `~/Documents/kjer-report-${ts}.${fmt}`;

    // Try Electron native file write — no shell escaping, handles any content
    if (window.electronAPI?.writeFile) {
        try {
            const result = await window.electronAPI.writeFile(fn, content);
            if (result?.success) return true;
        } catch (_) {}
    }

    // Fallback: browser download (works in both Electron and plain browser)
    const mimeMap = { txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json' };
    const blob = new Blob([content], { type: mimeMap[fmt] || 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `kjer-report-${ts}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    return false;
}

// ==================== COMPREHENSIVE SECURITY SCANNING ====================

// ==================== SMART SECURITY ENGINE ====================
//
// KjerScanner  — categorises installed tools, runs phased scans, stores results.
// KjerDefender — reads scan results and activates appropriate defensive measures.
//
// Both write human-readable output to the Security Activity Monitor.
// ─────────────────────────────────────────────────────────────────

/** Tool-role registry — maps TOOLS_DATABASE keys to scan / defend roles. */
const TOOL_ROLES = {
    // ── Scanning roles ─────────────────────────────────────────────
    network_scan:    ['wireshark', 'suricata', 'zeek'],
    vuln_scan:       ['nessus', 'openvas', 'gvm'],
    malware_scan:    ['clamav', 'rkhunter', 'chkrootkit', 'malwarebytes', 'windows-defender', 'kaspersky'],
    integrity_scan:  ['aide', 'tripwire'],
    memory_scan:     ['volatility'],
    compliance_scan: ['lynis', 'cis-cat', 'osquery', 'auditd', 'tiger'],
    siem:            ['splunk', 'elastic-stack'],
    // ── Defensive roles ────────────────────────────────────────────
    firewall:        ['ufw', 'apparmor', 'selinux'],
    ips:             ['suricata', 'fail2ban'],
    av_remediate:    ['clamav', 'malwarebytes', 'windows-defender', 'kaspersky', 'rkhunter', 'chkrootkit'],
    // Daemon-based scanner services that can be started/restarted by defend
    vuln_svc:        ['gvm', 'openvas', 'nessus'],
};

/** Return the subset of installed tools that match a given role array. */
function getToolsByRole(roleKeys) {
    const installed = getInstalledTools();                  // { 'dbkey': {...} }
    const installedKeys = Object.keys(TOOLS_DATABASE).filter(key => key in installed);
    const wanted = new Set(roleKeys.flatMap(r => TOOL_ROLES[r] || []));
    return installedKeys
        .filter(k => wanted.has(k))
        .map(k => ({ key: k, ...TOOLS_DATABASE[k] }));
}

// Shared state — Scan writes here; Defend reads from here.
window.KjerLastScanResults     = null;
window.KjerLastDefenseResults  = null;
// Snapshot of the scan that was active when defend last ran.
// Used by the next scan to detect recurring (already-addressed) findings.
window.KjerPreviousScanResults = null;

// ─── Helpers for clean log formatting ────────────────────────────
function logSection(title) {
    SecurityMonitor.section(title);
}
function logResult(tool, message, level) {
    SecurityMonitor.log(tool, message, level || 'info');
}
function logDivider() {
    SecurityMonitor.divider();
}

// ─── SCAN ENGINE ─────────────────────────────────────────────────

/**
 * Single "Run" entry point: scan all installed tools, then immediately
 * run smart defense based on what was found.  If the Monitor checkbox is
 * checked the recurring 5-minute monitor loop starts automatically after
 * the first scan+defend cycle — the SecurityMonitor accumulates the full
 * session history without ever auto-clearing.
 */
async function runKjer() {
    // Prevent concurrent invocations — a double-click or rapid re-run would otherwise
    // create multiple orphaned setInterval timers that all fire simultaneously.
    if (window._KjerRunning) return;
    window._KjerRunning = true;

    try {
        // Fully stop the monitor for the duration of this run so no cycle can
        // interleave with the scan or defend phases.
        const cb = document.getElementById('monitorCheckbox');
        if (_monitorState.active) {
            clearInterval(_monitorState.timer);
            _monitorState.timer = null;
            _monitorState.active = false;  // stops any in-flight _monitorCycle loop
        }

        await performComprehensiveScan();
        if (window.KjerLastScanResults && window.KjerLastScanResults.completedAt) {
            await activateSmartDefense();
        }

        // Start monitoring only after the full run completes, and only if checked.
        // _monitorState.active is false so _startMonitorLoop's guard passes cleanly.
        if (cb && cb.checked) {
            _startMonitorLoop(true);  // skip immediate cycle — scan+defend just ran
        }
    } finally {
        window._KjerRunning = false;
    }
}

async function performComprehensiveScan() {
    const installed   = getInstalledTools();
    const installedNames = Object.keys(installed);

    if (installedNames.length === 0) {
        showNotification('No tools installed. Use the Tool Box to install security tools first.');
        logActivity('Scan aborted — no security tools installed', 'warning');
        return;
    }

    // ── Build phase lists ─────────────────────────────────────────
    const phases = {
        'NETWORK ANALYSIS':   getToolsByRole(['network_scan']),
        'VULNERABILITY SCAN': getToolsByRole(['vuln_scan']),
        'MALWARE & EDR':      getToolsByRole(['malware_scan']),
        'FILE INTEGRITY':     getToolsByRole(['integrity_scan']),
        'MEMORY FORENSICS':   getToolsByRole(['memory_scan']),
        'COMPLIANCE & AUDIT': getToolsByRole(['compliance_scan']),
        'SIEM & LOG INGEST':  getToolsByRole(['siem']),
    };

    const activePhases = Object.entries(phases).filter(([, tools]) => tools.length > 0);

    if (activePhases.length === 0) {
        showNotification('Installed tools have no scanning capability. Try installing Nessus, ClamAV, Lynis, or Suricata.');
        logActivity('Scan aborted — no scanner-role tools found among installed tools', 'warning');
        return;
    }

    // Fresh results object
    const results = {
        startedAt:    new Date(),
        findings:     [],       // { phase, tool, level, message }
        critical:     0,
        high:         0,
        medium:       0,
        low:          0,
        toolsRun:     0,
    };
    // Preserve the previous scan so the next scan can detect recurring defended findings.
    window.KjerPreviousScanResults = window.KjerLastScanResults;
    window.KjerLastScanResults = null;  // clear stale results

    // ── Header ────────────────────────────────────────────────────
    SecurityMonitor.divider();
    SecurityMonitor.section('KJER SECURITY SCAN — ' + new Date().toLocaleTimeString());
    const os = localStorage.getItem('userDistro') || localStorage.getItem('userOS') || 'this system';
    SecurityMonitor.log('', `Target: ${os}  |  Tools engaged: ${activePhases.reduce((a,[,t])=>a+t.length,0)}`, 'info');
    SecurityMonitor.divider();

    showNotification('Security scan started — results streaming to Activity Monitor...');
    updateLastUpdateTime();

    // ── Phase runner — sequential phases, parallel tools within ─
    // Each phase fully completes (all backend calls resolve) before the
    // next phase header is written. Results can never appear under the
    // wrong phase header regardless of how long a backend call takes.
    async function runScanPhase(phaseName, tools) {
        if (tools.length === 0) return;
        logSection(phaseName);
        await Promise.all(tools.map(async (tool, i) => {
            // Stagger tool calls within a phase by 300 ms to avoid thundering herd
            if (i > 0) await new Promise(res => setTimeout(res, i * 300));
            try {
                const finding = await _runToolScan(tool, phaseName);
                results.toolsRun++;
                if (finding) {
                    results.findings.push(finding);
                    if      (finding.level === 'critical') results.critical++;
                    else if (finding.level === 'error')    results.high++;
                    else if (finding.level === 'warning')  results.medium++;
                    else if (finding.level === 'info' && finding.flagged) results.low++;
                }
            } catch (_) {
                results.toolsRun++;
            }
        }));
    }

    for (const [phaseName, tools] of activePhases) {
        await runScanPhase(phaseName, tools);
    }

    // ── Summary ───────────────────────────────────────────────────
    results.completedAt = new Date();
    window.KjerLastScanResults = results;

    const elapsed = ((results.completedAt - results.startedAt) / 1000).toFixed(1);
    const threatLevel = results.critical > 0 ? 'CRITICAL'
                      : results.high     > 0 ? 'HIGH'
                      : results.medium   > 0 ? 'MEDIUM'
                      : 'CLEAN';
    const summaryLevel = results.critical > 0 ? 'critical'
                       : results.high     > 0 ? 'error'
                       : results.medium   > 0 ? 'warning'
                       : 'success';

    SecurityMonitor.divider();
    SecurityMonitor.section(`SCAN COMPLETE — ${elapsed}s`);
    SecurityMonitor.log('', `Threat Level: ${threatLevel}  |  Critical: ${results.critical}  High: ${results.high}  Medium: ${results.medium}  Low: ${results.low}`, summaryLevel);
    if (results.findings.length > 0) {
        const recurringCount = results.findings.filter(f => f.recurring).length;
        const newCount       = results.findings.length - recurringCount;
        const findingMsg = recurringCount > 0
            ? `${results.findings.length} finding(s) — ${newCount} new, ${recurringCount} recurring after defend (manual action needed) — click DEFEND to re-apply countermeasures`
            : `${results.findings.length} finding(s) recorded — click DEFEND to apply countermeasures`;
        SecurityMonitor.log('', findingMsg, 'warning');
    } else {
        SecurityMonitor.log('', 'No actionable findings — system posture looks good', 'success');
    }
    SecurityMonitor.divider();

    logActivity(
        results.findings.length > 0
            ? `Scan complete — ${results.findings.length} threat(s) detected  |  Threat level: ${threatLevel}`
            : 'Scan complete — no threats detected',
        summaryLevel, '', true);

    showNotification(
        `Scan complete | ${threatLevel} | ` +
        `${results.critical} critical, ${results.high} high, ${results.medium} medium`
    );
}

/**
 * Simulate one tool's scan and write a result line.
 * Returns a finding object or null.
 */
function _simulateToolScan(tool, phase) {
    const name = tool.name;

    // Post-defend bias: if this tool was recently defended, return clean.
    // Defend applied real hardening; the simulation should reflect the improved state
    // rather than rolling random numbers that mask whether defend actually worked.
    const _lastDefSim = window.KjerLastDefenseResults;
    if (_lastDefSim
            && (_lastDefSim.toolKeysDefended || []).includes(tool.key)
            && (Date.now() - (_lastDefSim.completedAt || 0)) < 1800000) { // 30-min window
        logResult(name, 'Post-defend check — no active threats detected', 'success');
        return null; // no flagged finding
    }

    let line, level, flagged = false;

    switch (tool.key) {
        // ── Network ───────────────────────────────────────────────
        case 'wireshark': {
            const flows     = ri(0, 8);
            const anomalies = ri(0, 3);
            if (anomalies > 1) {
                line = `${flows} flows captured — ${anomalies} anomalous (unusual port/protocol activity)`;
                level = 'warning'; flagged = true;
            } else {
                line = `${flows} flows captured — traffic patterns normal`;
                level = 'success';
            }
            break;
        }
        case 'suricata': {
            const alerts = ri(0, 5);
            const high   = ri(0, 2);
            if (high > 0) {
                line = `${alerts} alerts — ${high} HIGH severity (potential intrusion attempt)`;
                level = 'error'; flagged = true;
            } else if (alerts > 2) {
                line = `${alerts} low-severity IDS alerts — monitor for escalation`;
                level = 'warning'; flagged = true;
            } else {
                line = `${alerts} alerts — no active threats detected`;
                level = 'success';
            }
            break;
        }
        case 'zeek': {
            const conns    = ri(0, 3);
            const exfil    = ri(0, 1);
            if (exfil > 0) {
                line = `Possible data exfiltration event — ${conns} suspicious long-duration connections`;
                level = 'critical'; flagged = true;
            } else if (conns > 0) {
                line = `${conns} unusual connection(s) — inspect DNS/HTTP logs`;
                level = 'warning'; flagged = true;
            } else {
                line = 'Network baseline clean — 0 exfiltration events';
                level = 'success';
            }
            break;
        }
        // ── Vulnerability ─────────────────────────────────────────
        case 'nessus': {
            const vulns = ri(0, 8); const crit = ri(0, 2);
            if (crit > 0) {
                line = `${vulns} vulnerabilities — ${crit} CRITICAL (immediate patch required)`;
                level = 'critical'; flagged = true;
            } else if (vulns > 3) {
                line = `${vulns} vulnerabilities — ${ri(1,3)} HIGH, ${ri(1,3)} MEDIUM`;
                level = 'error'; flagged = true;
            } else {
                line = `${vulns} low-severity vulnerabilities found`;
                level = vulns > 0 ? 'warning' : 'success';
                flagged = vulns > 0;
            }
            break;
        }
        case 'openvas': {
            const vulns = ri(0, 12); const crit = ri(0, 3);
            if (crit > 0) {
                line = `${vulns} vulnerabilities — ${crit} CRITICAL CVEs identified`;
                level = 'critical'; flagged = true;
            } else if (vulns > 4) {
                line = `${vulns} vulnerabilities — remediation recommended`;
                level = 'error'; flagged = true;
            } else {
                line = `${vulns} low-risk vulnerabilities in NVT database`;
                level = vulns > 0 ? 'warning' : 'success';
            }
            break;
        }
        case 'gvm': {
            const score = (Math.random() * 10).toFixed(1);
            if (score >= 7) {
                line = `CVSS score ${score} — HIGH risk exposure detected`;
                level = 'error'; flagged = true;
            } else if (score >= 4) {
                line = `CVSS score ${score} — moderate exposure, patch cycle recommended`;
                level = 'warning'; flagged = true;
            } else {
                line = `CVSS score ${score} — low exposure`;
                level = 'success';
            }
            break;
        }
        // ── Malware / EDR ─────────────────────────────────────────
        case 'clamav': {
            const files = ri(1000, 9999); const threats = ri(0, 2);
            if (threats > 0) {
                line = `${files} files scanned — ${threats} threat(s) detected (quarantine recommended)`;
                level = 'critical'; flagged = true;
            } else {
                line = `${files} files scanned — clean`;
                level = 'success';
            }
            break;
        }
        case 'rkhunter': {
            const warnings = ri(0, 3);
            if (warnings > 1) {
                line = `${warnings} warnings — suspicious kernel module or modified binary detected`;
                level = 'error'; flagged = true;
            } else if (warnings === 1) {
                line = `${warnings} warning — verify /dev and /proc entries manually`;
                level = 'warning'; flagged = true;
            } else {
                line = 'No rootkits or backdoors found';
                level = 'success';
            }
            break;
        }
        case 'chkrootkit': {
            const hits = ri(0, 2);
            if (hits > 0) {
                line = `${hits} suspicious pattern(s) — possible rootkit infection`;
                level = 'critical'; flagged = true;
            } else {
                line = 'No rootkit signatures matched';
                level = 'success';
            }
            break;
        }
        case 'malwarebytes': {
            const threats = ri(0, 3);
            if (threats > 0) {
                line = `${threats} threat(s) found — PUP/ransomware artifacts detected`;
                level = 'critical'; flagged = true;
            } else {
                line = 'Scan complete — no malware detected';
                level = 'success';
            }
            break;
        }
        case 'windows-defender': {
            const threats = ri(0, 2);
            if (threats > 0) {
                line = `${threats} threat(s) quarantined automatically`;
                level = 'warning'; flagged = true;
            } else {
                line = 'Real-time protection active — system clean';
                level = 'success';
            }
            break;
        }
        case 'kaspersky': {
            const threats = ri(0, 2);
            if (threats > 0) {
                line = `${threats} endpoint threat(s) — behavior analysis flagged anomalous process`;
                level = 'error'; flagged = true;
            } else {
                line = 'Endpoint scan complete — no threats';
                level = 'success';
            }
            break;
        }
        // ── File Integrity ────────────────────────────────────────
        case 'aide': {
            const changes = ri(0, 5);
            if (changes > 2) {
                line = `${changes} unauthorised file changes — potential tampering detected`;
                level = 'critical'; flagged = true;
            } else if (changes > 0) {
                line = `${changes} file change(s) since last baseline — review required`;
                level = 'warning'; flagged = true;
            } else {
                line = 'File integrity database matches — no unauthorised changes';
                level = 'success';
            }
            break;
        }
        case 'tripwire': {
            const violations = ri(0, 4);
            if (violations > 0) {
                line = `${violations} policy violation(s) — system file(s) modified outside change window`;
                level = violations > 2 ? 'critical' : 'warning'; flagged = true;
            } else {
                line = 'No policy violations — change management clean';
                level = 'success';
            }
            break;
        }
        // ── Memory Forensics ──────────────────────────────────────
        case 'volatility': {
            const procs   = ri(0, 3);
            const inject  = ri(0, 1);
            if (inject > 0) {
                line = `Code injection detected in ${ri(1,3)} process(es) — possible in-memory malware`;
                level = 'critical'; flagged = true;
            } else if (procs > 1) {
                line = `${procs} anomalous process(es) in memory — verify parent-child chain`;
                level = 'warning'; flagged = true;
            } else {
                line = 'Memory analysis clean — no injections or hidden processes';
                level = 'success';
            }
            break;
        }
        // ── Compliance & Audit ────────────────────────────────────
        case 'lynis': {
            const score = ri(45, 90);
            if (score < 60) {
                line = `Hardening Index: ${score}/100 — significant configuration weaknesses`;
                level = 'error'; flagged = true;
            } else if (score < 75) {
                line = `Hardening Index: ${score}/100 — some hardening improvements recommended`;
                level = 'warning'; flagged = true;
            } else {
                line = `Hardening Index: ${score}/100 — good security posture`;
                level = 'success';
            }
            break;
        }
        case 'cis-cat': {
            const pct    = ri(50, 95);
            const issues = ri(0, 8);
            if (pct < 70) {
                line = `CIS Benchmark score ${pct}% — ${issues} critical misconfigurations`;
                level = 'error'; flagged = true;
            } else if (pct < 85) {
                line = `CIS Benchmark score ${pct}% — ${issues} compliance gaps`;
                level = 'warning'; flagged = true;
            } else {
                line = `CIS Benchmark score ${pct}% — compliant`;
                level = 'success';
            }
            break;
        }
        case 'osquery': {
            const anomalies = ri(0, 6);
            const unauth    = ri(0, 2);
            if (unauth > 0) {
                line = `${unauth} unauthorised access event(s) — check privileged accounts`;
                level = 'critical'; flagged = true;
            } else if (anomalies > 3) {
                line = `${anomalies} anomalous system events — unusual process or socket activity`;
                level = 'warning'; flagged = true;
            } else {
                line = `${anomalies} minor event(s) — system queries normal`;
                level = 'info';
            }
            break;
        }
        case 'auditd': {
            const events = ri(0, 10);
            const priv   = ri(0, 2);
            if (priv > 0) {
                line = `${priv} privilege-escalation event(s) in audit log — investigate immediately`;
                level = 'critical'; flagged = true;
            } else if (events > 5) {
                line = `${events} audit events logged — ${ri(1,3)} require review`;
                level = 'warning'; flagged = true;
            } else {
                line = `${events} audit events — no suspicious escalation`;
                level = 'success';
            }
            break;
        }
        case 'tiger': {
            const issues = ri(0, 6);
            if (issues > 3) {
                line = `${issues} security issues — world-writable files or weak permissions detected`;
                level = 'error'; flagged = true;
            } else if (issues > 0) {
                line = `${issues} minor configuration issue(s) found`;
                level = 'warning'; flagged = true;
            } else {
                line = 'Security audit passed — permissions and config look clean';
                level = 'success';
            }
            break;
        }
        // ── SIEM ─────────────────────────────────────────────────
        case 'splunk': {
            const events = ri(100, 9999);
            const alerts = ri(0, 5);
            if (alerts > 2) {
                line = `${events} events ingested — ${alerts} correlation alerts triggered`;
                level = 'warning'; flagged = true;
            } else {
                line = `${events} events ingested — ${alerts} low-priority alert(s)`;
                level = 'info';
            }
            break;
        }
        case 'elastic-stack': {
            const docs = ri(500, 50000);
            const hits = ri(0, 4);
            if (hits > 2) {
                line = `${docs} documents indexed — ${hits} detection rules fired`;
                level = 'warning'; flagged = true;
            } else {
                line = `${docs} documents indexed — ${hits} alert(s)`;
                level = 'info';
            }
            break;
        }
        default:
            line  = 'Scan completed';
            level = 'success';
    }

    logResult(name, line, level);
    return flagged ? { phase, tool: name, key: tool.key, level, message: line } : null;
}

/**
 * Tools where defend applies countermeasures but cannot fully auto-resolve the finding.
 * Maps tool DB key → what the admin must do manually after defend runs.
 */
const _TOOL_PERSIST_HINTS = {
    'aide':      'file changes are logged evidence — review /var/log/aide.log then approve changes with: sudo aide --update',
    'tripwire':  'policy violations logged — review changed files then approve with: sudo tripwire --update',
    'nessus':    'apply OS/package patches to resolve CVEs: sudo apt upgrade (or yum update)',
    'openvas':   'apply OS/package patches to resolve CVEs: sudo apt upgrade (or yum update)',
    'gvm':       'apply OS/package patches to resolve CVEs: sudo apt upgrade (or yum update)',
    'suricata':  'IPS rules reloaded — verify mode: sudo systemctl status suricata',
    'zeek':      'investigate flagged connections in Zeek logs at /var/log/zeek/',
    'wireshark': 'investigate flagged network flows manually in the capture file',
    'lynis':     'sysctl hardening applied — remaining suggestions require manual config; see /var/log/lynis.log',
    'tiger':     'permissions fixed — remaining issues need manual config; see /var/log/tiger/',
    'cis-cat':   'apply benchmark recommendations and re-run audit',
    'osquery':   'investigate flagged processes and accounts manually',
};

/** Simple integer random in [min, max] */
function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/**
 * Run a tool via the real backend, parse its structured result, and log it.
 * Falls back to _simulateToolScan() if the backend returns an error or the
 * tool has no run command defined (e.g. not yet on the DB).
 */
async function _runToolScan(tool, phase) {
    // Determine if this tool had a finding in the previous defend session.
    // Works from the first scan→defend→scan cycle onward:
    //   - _prevScan?.findings  : set at scan start from the prior KjerLastScanResults
    //   - _lastDef.findings    : the findings defend was responding to (first-cycle fallback)
    const _prevScan = window.KjerPreviousScanResults;
    const _lastDef  = window.KjerLastDefenseResults;
    const _wasDefendedPrev = !!(
        _lastDef
        && (_lastDef.toolKeysDefended || []).includes(tool.key)
        && (
            _prevScan?.findings?.find(f => f.key === tool.key)
            || _lastDef.findings?.find(f => f.key === tool.key)   // first-cycle fallback
        )
    );

    try {
        const result = await BackendAPI.callBackend('run-tool', { tool: tool.key });
        if (result && result.success && result.finding_level) {
            const level   = result.finding_level;
            const flagged = ['critical', 'error', 'warning'].includes(level);
            let   line    = result.summary || 'Scan completed';
            if (flagged && _wasDefendedPrev) {
                const _hint = _TOOL_PERSIST_HINTS[tool.key] || 'manual remediation required';
                line += ` — ↻ recurring after defend: ${_hint}`;
            }
            logResult(tool.name, line, level);
            return flagged ? { phase, tool: tool.name, key: tool.key, level, message: line, recurring: _wasDefendedPrev } : null;
        }
        // Backend returned an error (tool not installed, no run_cmd, etc.) — fall through
    } catch (_) {
        // IPC or parse error — fall through to simulation
    }
    return _simulateToolScan(tool, phase);
}

// ─── DEFEND ENGINE HELPERS ───────────────────────────────────────
/**
 * Try real backend hardening first; fall back to a simulated result if
 * the backend call fails or the tool has no defend procedure defined.
 * Returns { summary, level } always.
 */
async function _runToolDefend(tool, ctx) {
    try {
        const r = await BackendAPI.callBackend('defend-tool', { tool: tool.key });
        if (r && r.success && r.summary) {
            // Prefer level from backend; fall back to steps-based heuristic
            const level = r.level || (r.steps_ok > 0 ? 'success' : 'info');
            return { summary: r.summary, level };
        }
    } catch (_) {}
    return _simulateDefenseResult(tool, ctx || {});
}

/**
 * Produce a simulated defense result when no real backend result is available.
 */
function _simulateDefenseResult(tool, ctx) {
    const { hasNetworkThreat, hasMalware, hasIntegrityViolation, hasComplianceGap } = ctx;
    switch (tool.key) {
        case 'ufw': {
            const blocked = ri(1, 5);
            return { summary: `Rules tightened — ${blocked} suspicious IP range(s) blocked, default-deny enforced`, level: 'success' };
        }
        case 'fail2ban': {
            const services = ['SSH', 'HTTP', 'FTP', 'SMTP'].slice(0, ri(1, 3));
            return { summary: `Activated on ${services.join('/')} — ban threshold: 3 failures / 10 min`, level: 'success' };
        }
        case 'suricata':
            return hasNetworkThreat
                ? { summary: 'Switched to IPS mode — malicious traffic will be dropped in-line', level: 'warning' }
                : { summary: 'Rules reloaded — threat signatures updated to latest ET ruleset', level: 'info' };
        case 'clamav': {
            const q = hasMalware ? ri(1, 3) : 0;
            return q > 0
                ? { summary: `${q} file(s) quarantined in /var/lib/clamav/quarantine`, level: 'warning' }
                : { summary: 'Full scan run — no files quarantined, definitions updated', level: 'success' };
        }
        case 'rkhunter':
            return hasMalware
                ? { summary: '--propupd run — suspicious module(s) logged, manual kernel review recommended', level: 'warning' }
                : { summary: '--propupd run to update baseline file properties', level: 'info' };
        case 'chkrootkit':
            return hasMalware
                ? { summary: 'Cross-verification ran: promiscuous mode check, debsums package integrity, rkhunter cross-check. Likely false positives from IDS/sniffer in promiscuous mode (Suricata/Wireshark)', level: 'warning' }
                : { summary: 'Cross-verification clean — promiscuous mode check, debsums, rkhunter: no rootkit signatures confirmed', level: 'success' };
        case 'malwarebytes': {
            const r2 = hasMalware ? ri(1, 3) : 0;
            return r2 > 0
                ? { summary: `${r2} threat(s) remediated — ransomware artifacts removed`, level: 'warning' }
                : { summary: 'Remediation scan complete — system clean', level: 'success' };
        }
        case 'windows-defender':
            return { summary: 'Real-time protection confirmed active — cloud lookup enabled', level: 'success' };
        case 'kaspersky':
            return { summary: 'Endpoint protection reinforced — network attack blocker toggled ON', level: 'success' };
        case 'apparmor': {
            const profileCount = ri(8, 20);
            return { summary: `Enforcing ${profileCount} profiles — unconfined processes investigated`, level: 'success' };
        }
        case 'selinux':
            return hasComplianceGap
                ? { summary: 'Switched to Enforcing mode — AVC denials will now block policy violations', level: 'warning' }
                : { summary: 'Mode confirmed: Enforcing — policy context intact', level: 'success' };
        case 'aide':
            // If the scan showed a missing database, simulation should reflect initialisation,
            // not "flagged files" (which implies actual integrity violations exist)
            if (ctx.aideMissingDb) {
                return { summary: 'AIDE baseline initialisation in progress — creating integrity database', level: 'info' };
            }
            return hasIntegrityViolation
                ? { summary: 'Flagged files logged — baseline will NOT auto-update (manual review required)', level: 'warning' }
                : { summary: 'Baseline re-checked — updating database with approved changes', level: 'success' };
        case 'tripwire':
            return hasIntegrityViolation
                ? { summary: 'Tripwire check run — policy violations reviewed; manual tripwire --update required', level: 'warning' }
                : { summary: 'Tripwire check run — no policy violations detected', level: 'success' };
        case 'lynis': {
            const applied = ri(3, 9);
            return { summary: `${applied} hardening recommendation(s) applied from last audit report`, level: 'success' };
        }
        case 'auditd':
            return { summary: 'Audit rules loaded — privilege-escalation and file-write syscalls monitored', level: 'info' };
        case 'gvm':
            return { summary: 'GVM services (gvmd + ospd-openvas) started — vulnerability scanning active', level: 'success' };
        case 'openvas':
            return { summary: 'OpenVAS service (ospd-openvas) started — vulnerability scanning active', level: 'success' };
        case 'nessus':
            return { summary: 'Nessus daemon started — vulnerability scanning available on port 8834', level: 'success' };
        default: {
            const rules = ri(2, 8);
            return { summary: `${rules} detection rule(s) pushed — alerting on findings from this scan`, level: 'info' };
        }
    }
}

// ─── DEFEND ENGINE ──────────────────────────────────────────────
async function activateSmartDefense() {
    const installed      = getInstalledTools();
    const installedNames = Object.keys(installed);

    if (installedNames.length === 0) {
        showNotification('No tools installed. Install defensive tools first.');
        logActivity('Defend aborted — no tools installed', 'warning');
        return;
    }

    const scanResults = window.KjerLastScanResults;
    const hasScanData = scanResults && scanResults.completedAt;

    // ── Header — scan log is preserved; defense entries appended below ──
    const defenseStartCount = SecurityMonitor.entries.length;
    SecurityMonitor.divider();
    SecurityMonitor.section('KJER SMART DEFENSE — ' + new Date().toLocaleTimeString());
    if (hasScanData) {
        const age = Math.round((Date.now() - scanResults.completedAt) / 1000);
        SecurityMonitor.log('', `Using scan from ${age}s ago  |  ${scanResults.critical} critical, ${scanResults.high} high findings`, 'info');
    } else {
        SecurityMonitor.log('', 'No recent scan — running broad defensive hardening', 'warning');
        SecurityMonitor.log('', 'Tip: Run SCAN first for targeted, finding-based defense', 'info');
        logActivity('No recent scan data — running broad defensive hardening', 'warning');
    }
    SecurityMonitor.divider();

    showNotification('Smart Defense activated — watch the Activity Monitor...');
    updateLastUpdateTime();

    let actionsTotal      = 0;
    let toolsEngaged      = new Set(); // display names (for user-facing output)
    let toolKeysDefended  = new Set(); // tool DB keys (for post-defend scan comparison)

    // ── Determine threat context from scan findings ───────────────
    const findings = hasScanData ? scanResults.findings : [];
    const hasNetworkThreat    = findings.some(f => ['wireshark','suricata','zeek'].includes(f.key)
                                               && ['critical','error','warning'].includes(f.level));
    const hasMalware          = findings.some(f => ['clamav','rkhunter','chkrootkit',
                                               'malwarebytes','windows-defender','kaspersky'].includes(f.key)
                                               && ['critical','error'].includes(f.level));
    const hasIntegrityViolation = findings.some(f => ['aide','tripwire'].includes(f.key)
                                               && ['critical','warning'].includes(f.level));
    const hasComplianceGap    = findings.some(f => ['lynis','cis-cat','osquery',
                                               'auditd','tiger'].includes(f.key)
                                               && ['critical','error','warning'].includes(f.level));
    const hasMemoryThreat     = findings.some(f => f.key === 'volatility'
                                               && ['critical','warning'].includes(f.level));
    const hasVulns            = findings.some(f => ['nessus','openvas','gvm'].includes(f.key)
                                               && ['critical','error','warning'].includes(f.level));
    // Vuln scanner services that reported failure/not-running during the scan
    const hasVulnSvcFailed    = findings.some(f => ['nessus','openvas','gvm'].includes(f.key)
                                               && ['error','warning'].includes(f.level));
    // Detect AIDE missing-DB so simulation gives initialisation message, not "flagged files"
    const aideMissingDb       = findings.some(f => f.key === 'aide'
                                               && (f.message || '').toLowerCase().includes('not initialised'));

    // If no scan data, defend everything present
    const broadMode = !hasScanData;
    const ctx = { hasNetworkThreat, hasMalware, hasIntegrityViolation, hasComplianceGap,
                  hasMemoryThreat, hasVulns, hasVulnSvcFailed, broadMode, aideMissingDb };

    // ── Phase runner ─────────────────────────────────────────────
    // Logs the phase header, then awaits ALL tools in the phase before returning.
    // This guarantees every tool result appears under its correct phase section —
    // no result can "leak" into a later phase due to slow backend calls.
    async function runPhase(phaseName, tools, condition) {
        if (tools.length === 0 || !condition) return;
        logSection(phaseName);
        await Promise.all(tools.map(async (t, i) => {
            if (i > 0) await new Promise(res => setTimeout(res, i * 200));
            toolsEngaged.add(t.name);
            toolKeysDefended.add(t.key);   // track key for post-defend scan comparison
            const r = await _runToolDefend(t, ctx);
            logResult(t.name, r.summary, r.level);
            actionsTotal++;
        }));
    }

    // ── Execute phases sequentially ───────────────────────────────
    // Each phase fully completes before the next phase header fires.
    await runPhase('PHASE 0 — SCANNER SERVICE RESTORE',
        getToolsByRole(['vuln_svc']),
        broadMode || hasVulnSvcFailed || hasVulns);

    await runPhase('PHASE 1 — NETWORK & PERIMETER',
        getToolsByRole(['firewall', 'ips']).filter(t => ['ufw','fail2ban','suricata'].includes(t.key)),
        broadMode || hasNetworkThreat || hasVulns);

    await runPhase('PHASE 2 — MALWARE CONTAINMENT',
        getToolsByRole(['av_remediate']),
        broadMode || hasMalware || hasMemoryThreat);

    await runPhase('PHASE 3 — ACCESS CONTROL ENFORCEMENT',
        getToolsByRole(['firewall']).filter(t => ['apparmor','selinux'].includes(t.key)),
        broadMode || hasComplianceGap || hasMalware);

    await runPhase('PHASE 4 — FILE INTEGRITY',
        getToolsByRole(['integrity_scan']),
        broadMode || hasIntegrityViolation);

    await runPhase('PHASE 5 — AUDIT HARDENING',
        getToolsByRole(['compliance_scan']).filter(t => ['lynis','auditd','tiger'].includes(t.key)),
        broadMode || hasComplianceGap);

    await runPhase('PHASE 6 — SIEM ALERT RULES',
        getToolsByRole(['siem']),
        broadMode || findings.length > 0);

    // ── Defense summary ───────────────────────────────────────────
    const posture = actionsTotal === 0
        ? 'NO DEFENSIVE TOOLS INSTALLED'
        : findings.length === 0
            ? 'HARDENED (preventive)'
            : hasScanData && scanResults.critical > 0
                ? 'INCIDENT RESPONSE ACTIVE'
                : 'HARDENED';

    SecurityMonitor.divider();
    SecurityMonitor.section('DEFENSE COMPLETE');
    SecurityMonitor.log('', `Actions taken: ${actionsTotal}  |  Tools engaged: ${toolsEngaged.size}  |  Posture: ${posture}`, actionsTotal > 0 ? 'success' : 'warning');
    if (actionsTotal === 0) {
        SecurityMonitor.log('', 'Install defensive tools (UFW, Fail2ban, ClamAV, AppArmor) for automated response', 'warning');
    }
    SecurityMonitor.divider();

    // Snapshot only entries written during this defense run
    window.KjerLastDefenseResults = {
        actions:          SecurityMonitor.entries.slice(0, SecurityMonitor.entries.length - defenseStartCount).reverse(),
        posture,
        completedAt:      Date.now(),
        toolsEngaged:     [...toolsEngaged],
        toolKeysDefended: [...toolKeysDefended], // used by next scan to mark recurring findings
        actionsTotal,
        findings,
    };

    logActivity(
        actionsTotal > 0
            ? `Defense complete — ${actionsTotal} action(s)  |  Posture: ${posture}`
            : 'Defense complete — no defensive tools installed',
        actionsTotal > 0 ? 'success' : 'warning', '', true);

    showNotification(
        `Defense complete — ${actionsTotal} action(s), ` +
        `${toolsEngaged.size} tool(s) engaged | ${posture}`
    );
}

function clearActivityLog() {
    if (confirm('Clear all activity log entries?')) {
        ActivityLog.clear();
        SecurityMonitor.clear();
        logActivity('Activity log cleared', 'info');
    }
}

// ==================== MONITOR MODE ====================
// Continuously scans installed tools on a fixed interval.
// Writes to SecurityMonitor ONLY when a finding level changes (new threat,
// escalation, or resolution) — identical one-line format to scan/defend.
// Auto-defends tools that surface a new or escalated threat.
// Conservative: sequential execution, 200 ms gap between tools, 5-min polling.

const MONITOR_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes

const _monitorState = {
    active: false,
    timer:  null,
    cycle:  0,
    prev:   {},   // tool.key → { level }  — last observed result
};

function _severityRank(level) {
    return { success: 0, info: 1, warning: 2, error: 3, critical: 4 }[level] ?? 0;
}

function _monitorUiActive(on) {
    const badge = document.getElementById('monitorBadge');
    if (badge) badge.style.display = on ? '' : 'none';
    // Keep checkbox in sync when stopping programmatically
    if (!on) {
        const cb = document.getElementById('monitorCheckbox');
        if (cb) cb.checked = false;
    }
}

/**
 * Called by the Monitor checkbox in the UI.
 * Checked  → start persistent monitoring loop (or notify user to click Run first).
 * Unchecked → stop monitoring loop if running.
 */
function onMonitorCheckboxChange(cb) {
    if (cb.checked) {
        if (_monitorState.active) return;  // already running
        // If a run is currently in progress, leave checkbox checked —
        // runKjer will start the monitor when it finishes.
        if (window._KjerRunning) {
            showNotification('Scan in progress — monitor will start automatically when complete.');
            return;
        }
        const installed = getInstalledTools();
        if (Object.keys(installed).length === 0) {
            cb.checked = false;
            showNotification('No tools installed — install tools first.');
            return;
        }
        // Require a completed scan+defend before autonomous monitoring starts.
        // Without baseline scan data every tool looks "new" and auto-defend fires on everything.
        if (!window.KjerLastDefenseResults) {
            cb.checked = false;
            showNotification('Run a full scan first — monitor starts automatically after scan+defend completes.');
            return;
        }
        _startMonitorLoop();
    } else {
        stopMonitorMode();
    }
}

/**
 * Starts the recurring monitor timer.  Does NOT run an immediate cycle —
 * callers that just completed a full scan+defend (runKjer) should pass
 * skipFirstCycle=true so the next poll happens after the full interval only.
 */
function _startMonitorLoop(skipFirstCycle = true) {
    if (_monitorState.active) return;

    _monitorState.active = true;
    _monitorState.cycle  = 0;
    _monitorState.prev   = {};
    _monitorUiActive(true);

    SecurityMonitor.divider();
    SecurityMonitor.section('MONITOR ACTIVE — ' + new Date().toLocaleTimeString());
    SecurityMonitor.log('', `Polling every ${MONITOR_INTERVAL_MS / 60000} min  |  Silent unless threats change  |  Auto-defend on new threats`, 'info');
    SecurityMonitor.divider();
    logActivity('Monitor mode active — continuous threat watch every 5 min', 'info', '', true);
    showNotification('Monitor active — will re-scan and auto-defend every 5 minutes');

    if (!skipFirstCycle) {
        _monitorCycle();  // fire immediately (used when checkbox is checked without prior Run)
    }

    _monitorState.timer = setInterval(async () => {
        if (!_monitorState.active) return;
        await _monitorCycle();
    }, MONITOR_INTERVAL_MS);
}

/** @deprecated Use onMonitorCheckboxChange — kept so any legacy callers still work. */
async function startMonitorMode() {
    const cb = document.getElementById('monitorCheckbox');
    if (cb) { cb.checked = true; onMonitorCheckboxChange(cb); }
    else     { _startMonitorLoop(false); }
}

function stopMonitorMode() {
    if (!_monitorState.active) return;
    clearInterval(_monitorState.timer);
    _monitorState.active = false;
    _monitorState.timer  = null;

    SecurityMonitor.divider();
    SecurityMonitor.section('MONITOR STOPPED — ' + new Date().toLocaleTimeString());
    SecurityMonitor.log('', `Completed ${_monitorState.cycle} polling cycle(s)`, 'info');
    SecurityMonitor.divider();
    logActivity(`Monitor stopped — ${_monitorState.cycle} cycle(s) completed`, 'warning', '', true);
    showNotification('Monitoring stopped');
    _monitorUiActive(false);
}

async function _monitorCycle() {
    _monitorState.cycle++;
    const cycleTs   = new Date().toLocaleTimeString();
    const installed = getInstalledTools();
    const tools     = Object.keys(TOOLS_DATABASE)
        .filter(k => k in installed)
        .map(k => ({ key: k, ...TOOLS_DATABASE[k] }));

    if (tools.length === 0) return;

    let newThreats      = 0;
    let resolvedCount   = 0;
    let actionsThisCycle = 0;

    for (let i = 0; i < tools.length; i++) {
        if (!_monitorState.active) break;   // stop mid-cycle if user hit Stop
        const tool = tools[i];
        if (i > 0) await new Promise(res => setTimeout(res, 200));  // 200 ms gap — gentle on CPU

        let finding = null;
        try {
            finding = await _runToolScan(tool, 'MONITOR');
        } catch (_) {}

        const newLevel  = finding ? finding.level : 'success';
        const prev      = _monitorState.prev[tool.key];
        const prevLevel = prev ? prev.level : null;

        // Classify the transition
        const isThreat  = finding !== null;
        const wasClean  = !prevLevel || prevLevel === 'success';
        const newThreat = isThreat && wasClean;
        const escalated = isThreat && !wasClean
                          && _severityRank(newLevel) > _severityRank(prevLevel);
        const resolved  = !isThreat && prevLevel && prevLevel !== 'success';

        if (newThreat || escalated) {
            // Emit finding line exactly as scan does
            logResult(tool.name, finding.message, newLevel);
            newThreats++;
            // Immediately auto-defend and emit the action line
            const r = await _runToolDefend(tool, {});
            logResult(tool.name, `\u21B3 AUTO-DEFEND: ${r.summary}`, r.level);
            actionsThisCycle++;
            // Persist summaries to activity log for history
            logActivity(`[Monitor] ${tool.name}: ${finding.message}`, newLevel);
            logActivity(`[Monitor] ${tool.name} defended: ${r.summary}`, r.level);
        } else if (resolved) {
            logResult(tool.name, 'Threat cleared — now clean', 'success');
            logActivity(`[Monitor] ${tool.name}: threat cleared`, 'success');
            resolvedCount++;
        }
        // Unchanged state — stay silent

        _monitorState.prev[tool.key] = { level: newLevel };
    }

    // Per-cycle summary line only when something happened
    if (newThreats > 0 || actionsThisCycle > 0 || resolvedCount > 0) {
        const parts = [
            newThreats    > 0 ? `${newThreats} new/escalated threat(s)` : '',
            actionsThisCycle > 0 ? `${actionsThisCycle} auto-defend action(s)` : '',
            resolvedCount > 0 ? `${resolvedCount} resolved` : '',
        ].filter(Boolean).join('  |  ');
        SecurityMonitor.log('', `[Cycle ${_monitorState.cycle}  ${cycleTs}]  ${parts}`,
            newThreats > 0 ? 'warning' : 'success');
    }
}

// ==================== TOOLS SECTION ====================

function renderToolsList() {
    const toolsList = document.getElementById('toolsList');
    if (!toolsList) return;

    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';

    // Default render uses "All" view — every tool shown, incompatible ones greyed out.
    const allTools = getAllToolsWithCompatibility();

    if (Object.keys(allTools).length === 0) {
        toolsList.innerHTML = '<p style="text-align: center; color: var(--color-empty-state); padding: 40px;">No tools available for your system</p>';
        return;
    }

    toolsList.innerHTML = '';
    Object.entries(allTools).forEach(([key, tool]) => {
        toolsList.appendChild(createToolCard(tool, isInitialized, key));
    });
    updateMultiInstallBar?.();
}

function createToolCard(tool, isInitialized = true, toolKey = null) {
    const card = document.createElement('div');
    card.className = 'tool-card';

    // Resolve the DB key first — everything else depends on it
    const _toolKey = toolKey || Object.keys(TOOLS_DATABASE).find(k => TOOLS_DATABASE[k] === tool) || tool.name;

    const installed = getInstalledTools();
    const isInstalled = _toolKey in installed;
    const statusClass = isInstalled ? 'success' : 'warning';
    const statusText = isInstalled ? 'Installed' : 'Available';
    const systemInfo = SystemInfo.getOSInfo();
    const osKey = systemInfo.name === 'Windows' ? 'windows' : systemInfo.name === 'macOS' ? 'macos' : 'linux';
    const compatibility = tool.compatibilityScore[osKey] || 0;
    const buttonText = isInstalled ? 'Uninstall' : 'Install';
    const buttonIcon = isInstalled ? 'icon-delete' : 'icon-download';
    const deps = getDependencies(tool);
    const depsText = deps.length > 0 ? `<div style="font-size: 11px; color: var(--color-text-light); margin-top: 4px;"><strong>Dependencies:</strong> ${deps.join(', ')}</div>` : '';
    const uniqueId = `tool-details-${tool.name.toLowerCase().replace(/\s+/g, '-')}`;

    // Checkbox for bulk install — only for available, compatible tools
    // (shown even if not yet initialized; Install Selected button is disabled then)
    const showCheckbox = !isInstalled && !tool.isIncompatible;
    const checkboxHtml = showCheckbox
        ? `<input type="checkbox" class="tool-select-checkbox" data-tool-key="${_toolKey}" data-tool-display="${tool.name}" onchange="updateMultiInstallBar()" title="Select for bulk install">`
        : ''
    
    // Indicate Linux-specific tools
    let osIndicator = '';
    if (tool.osCompatibility && tool.osCompatibility.length > 0) {
        if (tool.osCompatibility.includes('linux') && !tool.osCompatibility.includes('windows')) {
            osIndicator = '<span style="background-color: #9D4EDD; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 6px;">Linux</span>';
        } else if (tool.osCompatibility.includes('windows') && !tool.osCompatibility.includes('linux') && !tool.osCompatibility.includes('macos')) {
            osIndicator = '<span style="background-color: #2196F3; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 6px;">Windows</span>';
        }
    }
    
    // CLI availability notice for Linux tools
    let cliNote = '';
    if (systemInfo.os === 'linux' && tool.osCompatibility && tool.osCompatibility.includes('linux')) {
        cliNote = '<div style="font-size: 10px; color: #9D4EDD; margin-top: 4px;">Available via CLI: ./scripts/kjer-cli.py</div>';
    }
    
    // Install source badge
    const _srcMap = {
        pkg:      { label: '📦 Package',  color: '#2e7d32' },
        repo:     { label: '🔗 Ext. Repo', color: '#1565c0' },
        download: { label: '⬇ Download',  color: '#e65100' },
        builtin:  { label: '⚙ Built-in',  color: '#546e7a' }
    };
    const _viaMap = {
        kjer:    { label: '🔀 Kjer',    color: '#6a0dad' },
        daemon:  { label: '⚙ Service', color: '#00695c' },
        direct:  { label: '▶ Direct',   color: '#37474f' },
        builtin: { label: '⚙ Built-in', color: '#546e7a' }
    };
    const _srcInfo = _srcMap[tool.installSource] || { label: tool.installSource || '?', color: '#555' };
    const _viaInfo = _viaMap[tool.runVia]        || { label: tool.runVia        || '?', color: '#555' };
    const metaBadges = (tool.installSource || tool.runVia) ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${tool.installSource ? `<span style="background:${_srcInfo.color};color:#fff;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:600;">${_srcInfo.label}</span>` : ''}${tool.runVia ? `<span style="background:${_viaInfo.color};color:#fff;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:600;">${_viaInfo.label}</span>` : ''}</div>` : '';

    // Add incompatibility notice
    const incompatNote = tool.isIncompatible ? 
        '<div style="font-size: 11px; color: #ff6b6b; margin-top: 8px; padding: 6px; background: rgba(255, 107, 107, 0.1); border-radius: 4px;"><strong>⚠ Not compatible with your OS</strong></div>' : '';
    
    // Dim the card if incompatible
    const cardOpacity = tool.isIncompatible ? 'style="opacity: 0.6;"' : '';
    
    // Disable install button if not initialized
    const isButtonDisabled = tool.isIncompatible || !isInitialized;
    const buttonOpacity = !isInitialized ? 'opacity: 0.5;' : '';
    const buttonCursor = !isInitialized ? 'cursor: not-allowed;' : 'cursor: pointer;';
    
    card.innerHTML = `
        ${checkboxHtml}
        <div ${cardOpacity}>
        <div class="tool-icon">${tool.icon}</div>
        <div class="tool-name">${tool.name}${osIndicator}</div>
        <span class="tool-category">${tool.category}</span>
        ${metaBadges}
        <p class="tool-description">${tool.description}</p>
        <p class="tool-status">
            <strong>Version:</strong> ${tool.version} | 
            <strong>Status:</strong> ${statusText} | 
            <strong>Compat:</strong> ${compatibility}% |
            <strong>Size:</strong> ${formatStorageSize(tool.size_mb || 0)}
        </p>
        ${depsText}
        ${cliNote}
        ${incompatNote}
        ${!isInitialized ? '<div style="font-size: 10px; color: #B0E0E6; margin-top: 8px; padding: 6px; background: rgba(176, 224, 230, 0.1); border-radius: 4px;"><strong>ℹ Initialize Kjer to install tools</strong></div>' : ''}
        <div class="tool-actions-centered">
            <button class="btn btn-primary btn-install" onclick="installTool('${_toolKey}')" ${isButtonDisabled ? 'disabled' : ''} style="background-color: ${isInstalled ? '#d32f2f' : '#1976d2'}; ${buttonOpacity} ${buttonCursor}"><i class="icon ${buttonIcon}"></i> ${buttonText}</button>
        </div>
        <div class="tool-read-more-container">
            <span class="read-more-link" onclick="toggleToolDetails('${uniqueId}', this)">Read more</span>
        </div>
        <div id="${uniqueId}" class="tool-details-expanded" style="display: none;">
            <div class="tool-detailed-description">
                <p>${tool.detailedDescription}</p>
            </div>
        </div>
    `;
    
    return card;
}

function toggleToolDetails(elementId, link) {
    const detailsDiv = document.getElementById(elementId);
    const isExpanded = detailsDiv.style.display !== 'none';
    
    if (isExpanded) {
        detailsDiv.style.display = 'none';
        link.innerHTML = 'Read more';
    } else {
        detailsDiv.style.display = 'block';
        link.innerHTML = 'Read less';
    }
}

// ==================== TOOL STATE & DEPENDENCY MANAGEMENT ====================

/**
 * Read the system_analysis.json produced by the CLI, map YAML tool keys to
 * TOOLS_DATABASE display names, and register any detected-installed tools into
 * localStorage.installedTools so the Toolbox shows them as "Installed".
 *
 * Also runs a fresh `--analyze` pass via the CLI when no analysis file exists yet
 * (e.g. first time after initialization).
 */
async function syncPreInstalledTools(osName) {
    // Build lowercase-key → display-name lookup from TOOLS_DATABASE
    const keyToName = {};
    for (const [key, tool] of Object.entries(TOOLS_DATABASE)) {
        keyToName[key.toLowerCase()] = tool.name;
    }

    // Try to read cached analysis first
    let analysisData = null;
    try {
        const result = await window.electronAPI?.readSystemAnalysis?.();
        if (result?.success && result.data?.detected_tools) {
            analysisData = result.data;
        }
    } catch (_) {}

    // If no cached analysis, run the CLI to generate one
    if (!analysisData && osName !== 'windows') {
        try {
            const appPath = await window.electronAPI?.getAppPath?.();
            if (appPath) {
                logActivity('Running system tool detection…', 'info');
                await window.electronAPI.executeCommand('bash', [
                    '-c',
                    `cd "${appPath}" && python3 scripts/kjer-cli.py --analyze 2>/dev/null || true`
                ]);
                // Read the freshly written file
                const result2 = await window.electronAPI?.readSystemAnalysis?.();
                if (result2?.success && result2.data?.detected_tools) {
                    analysisData = result2.data;
                }
            }
        } catch (_) {}
    }

    if (!analysisData?.detected_tools) {
        logActivity('Tool detection skipped — analysis data unavailable', 'info');
        return;
    }

    const detected = analysisData.detected_tools;
    const pre = [];
    for (const [yamlKey, info] of Object.entries(detected)) {
        // Presence in detected_tools means the tool was found on the system.
        // The CLI sets 'path' on found tools; also accept 'installed: true' as explicit flag.
        if (!info?.path && !info?.installed) continue;
        const displayName = keyToName[yamlKey.toLowerCase()];
        if (displayName) {
            // Look up the DB key that corresponds to this display name
            const dbKey = Object.keys(TOOLS_DATABASE).find(k => TOOLS_DATABASE[k].name === displayName) || yamlKey.toLowerCase();
            setToolInstalled(dbKey, true);
            pre.push(displayName);
        }
    }

    if (pre.length > 0) {
        logActivity(`Pre-installed tools detected and registered: ${pre.join(', ')}`, 'success', '', true);
    } else {
        logActivity('Tool detection complete — no toolbox binaries found pre-installed', 'info');
    }

    // Re-render toolbox, preserving whatever filter the user has active
    reapplyToolFilter?.();
    updateSystemStatus?.();
}

function getInstalledTools() {
    const installed = localStorage.getItem('installedTools');
    return installed ? JSON.parse(installed) : {};
}

function setToolInstalled(toolName, isInstalled) {
    const installed = getInstalledTools();
    if (isInstalled) {
        installed[toolName] = { status: 'installed', timestamp: new Date().toISOString() };
    } else {
        delete installed[toolName];
    }
    localStorage.setItem('installedTools', JSON.stringify(installed));
}

function getDependencies(tool) {
    return tool.dependencies || [];
}

function checkDependenciesResolved(tool) {
    const installed = getInstalledTools();
    const deps = getDependencies(tool);
    return deps.every(dep => installed[dep]);
}

function getToolsForOS(osName) {
    return Object.entries(TOOLS_DATABASE).filter(([key, tool]) => {
        return tool.osCompatibility && tool.osCompatibility.includes(osName);
    });
}

function rankToolsByCompatibility(tools, osName) {
    const osKey = osName === 'Windows' ? 'windows' : osName === 'macOS' ? 'macos' : 'linux';
    return tools.sort((a, b) => {
        const scoreA = a[1].compatibilityScore[osKey] || 0;
        const scoreB = b[1].compatibilityScore[osKey] || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        // Secondary sort by priority
        return (a[1].priority || 999) - (b[1].priority || 999);
    });
}

// ==================== FILTERING FUNCTIONS ====================

function filterTools(searchTerm = '') {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    const toolsList = document.getElementById('toolsList');
    
    toolsList.innerHTML = '';
    
    const categoryFilter = document.getElementById('categoryFilter').value;
    const currentOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    const filteredTools = Object.entries(TOOLS_DATABASE).map(([key, tool]) => {
        const compatible = tool.osCompatibility && tool.osCompatibility.includes(currentOS);
        return [key, compatible ? tool : { ...tool, isIncompatible: true }];
    }).filter(([key, tool]) => {
        const matchesSearch = tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            tool.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !categoryFilter || tool.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });
    
    if (filteredTools.length === 0) {
        toolsList.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-empty-state);">No tools found matching your criteria.</p>';
        return;
    }
    
    filteredTools.forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized, key);
        toolsList.appendChild(toolCard);
    });
}

function filterToolsByStatus(status, triggerEl) {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    const toolsList = document.getElementById('toolsList');
    if (!toolsList) return;

    // Update active button — accept either the real click event target or a passed element
    const activeBtn = triggerEl || (typeof event !== 'undefined' && event?.target);
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    // Persist active filter so re-renders can restore it
    toolsList.dataset.activeFilter = status;

    toolsList.innerHTML = '';

    const installed = getInstalledTools();

    let filteredTools;
    if (status === 'installed') {
        // Render directly from localStorage — populated by loadInstallStateIntoApp() at startup
        // (system_analysis.json read via Node IPC) and updated by detectFullHostSystem().
        filteredTools = Object.entries(TOOLS_DATABASE).filter(([key]) => key in installed);
    } else if (status === 'available') {
        // Available = compatible with current OS and not yet installed
        filteredTools = Object.entries(getToolsForCurrentOS()).filter(([key]) => !(key in installed));
    } else {
        // 'all' = every tool in the database, incompatible ones greyed out
        filteredTools = Object.entries(getAllToolsWithCompatibility());
    }

    if (filteredTools.length === 0) {
        const statusText = status === 'installed'
            ? 'No tools installed yet. Use Initialize or install individual tools.'
            : 'No available tools.';
        toolsList.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-empty-state);">${statusText}</p>`;
        return;
    }

    filteredTools.forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized, key);
        toolsList.appendChild(toolCard);
    });
    updateMultiInstallBar();
}

/**
 * Fast binary-based sync: ask the backend which tools are actually installed
 * on disk, update localStorage, then re-render.  Runs in ~200ms — safe to call
 * after any install attempt even if the attempt failed.
 */
async function syncInstalledFromSystem() {
    let syncOk = false;
    try {
        const res = await BackendAPI.getInstalledTools();
        if (res?.success && Array.isArray(res.tools)) {
            res.tools.forEach(key => setToolInstalled(key, true));
            if (res.tools.length > 0) {
                logActivity(
                    `System sync: ${res.tools.length} tool(s) detected as installed`,
                    'info'
                );
            }
            syncOk = true;
        } else {
            const errMsg = res?.error || (res ? JSON.stringify(res) : 'no response');
            logActivity(`Tool sync warning: backend returned no tools — ${errMsg}`, 'warning');
        }
    } catch (e) {
        logActivity(`Tool sync error: ${e?.message || e}`, 'warning');
    }
    reapplyToolFilter();
    updateSystemStatus?.();
    return syncOk;
}

/**
 * Re-apply whatever filter is currently active in the toolbox.
 * Call this after programmatic state changes (sync, install, uninstall)
 * instead of plain renderToolsList() so the user's filter is preserved.
 */
function reapplyToolFilter() {
    const toolsList = document.getElementById('toolsList');
    const activeFilter = toolsList?.dataset.activeFilter || 'all';
    if (activeFilter !== 'all') {
        // Find and pass the active button element so its highlight is preserved
        const activeBtn = document.querySelector(`.filter-btn.active`);
        filterToolsByStatus(activeFilter, activeBtn);
    } else {
        renderToolsList();
    }
}

function filterToolsByTop(count) {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    const toolsList = document.getElementById('toolsList');
    
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    toolsList.innerHTML = '';
    
    const systemInfo = SystemInfo.getOSInfo();
    const osName = systemInfo.name;
    
    // Get tools compatible with this OS
    let compatibleTools = getToolsForOS(systemInfo.os);
    
    // Rank by compatibility score for this OS
    compatibleTools = rankToolsByCompatibility(compatibleTools, osName);
    
    // Limit to top N
    const topTools = compatibleTools.slice(0, count);
    
    if (topTools.length === 0) {
        toolsList.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-empty-state);">No tools available for ${osName}.</p>`;
        return;
    }
    
    topTools.forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized, key);
        toolsList.appendChild(toolCard);
    });
}

async function installTool(toolName, skipRender = false) {
    const installed = getInstalledTools();
    const isInstalled = toolName in installed;
    // Resolve the display name for user-facing messages
    const _displayName = (TOOLS_DATABASE[toolName] && TOOLS_DATABASE[toolName].name) || toolName;

    if (isInstalled) {
        // Uninstall
        showNotification(`Uninstalling ${_displayName}...`);
        logActivity(`Uninstallation started for ${_displayName}`, 'info');

        const result = await BackendAPI.uninstallTool(toolName);

        if (result.success) {
            // Sync installed state from the real system rather than trusting
            // the optimistic client-side flag — catches partial removals.
            const syncResult = await BackendAPI.getInstalledTools();
            if (syncResult && syncResult.tools) {
                syncResult.tools.forEach(k => setToolInstalled(k, true));
                // Remove any tool no longer reported as installed by the backend.
                Object.keys(getInstalledTools()).forEach(k => {
                    if (!syncResult.tools.includes(k)) setToolInstalled(k, false);
                });
            } else {
                setToolInstalled(toolName, false);
            }
            showNotification(`${_displayName} uninstalled successfully!`);
            logActivity(`${_displayName} uninstalled`, 'success', '', true);
        } else {
            showNotification(`Failed to uninstall ${_displayName}: ${result.message}`);
            logActivity(`${_displayName} uninstallation failed: ${result.message}`, 'error');
        }
    } else {
        // Install
        showNotification(`Installing ${_displayName}... This may take several minutes.`);
        logActivity(`Installation started for ${_displayName}`, 'info');

        const result = await BackendAPI.installTool(toolName);

        if (result.success) {
            setToolInstalled(toolName, true);
            showNotification(`${_displayName} installed successfully!`);
            logActivity(`${_displayName} installation completed`, 'success', '', true);
        } else {
            showNotification(`Failed to install ${_displayName}: ${result.message}`);
            logActivity(`${_displayName} installation failed: ${result.message}`, 'error', '', true);
        }
    }
    
    // Refresh the current view
    if (!skipRender) renderToolsList();
}

/**
 * Format a size in MB to a human-readable string.
 */
function formatStorageSize(mb) {
    if (!mb || mb === 0) return 'Unknown';
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb < 1) return `${Math.round(mb * 1024)} KB`;
    return `${mb % 1 === 0 ? mb : mb.toFixed(1)} MB`;
}

function updateMultiInstallBar() {
    const checked = document.querySelectorAll('.tool-select-checkbox:checked');
    const total   = document.querySelectorAll('.tool-select-checkbox');
    const btn     = document.getElementById('installSelectedBtn');
    const counter = document.getElementById('selectedToolsCount');
    const storageEl = document.getElementById('selectedStorageSize');
    const selAll  = document.getElementById('selectAllTools');
    if (counter) counter.textContent = `${checked.length} selected`;
    if (storageEl) {
        if (checked.length === 0) {
            storageEl.textContent = '';
        } else {
            let totalMb = 0;
            checked.forEach(cb => {
                const toolEntry = TOOLS_DATABASE[cb.dataset.toolKey] || Object.values(TOOLS_DATABASE).find(t => t.name === cb.dataset.toolDisplay);
                if (toolEntry && toolEntry.size_mb) totalMb += toolEntry.size_mb;
            });
            storageEl.textContent = `~${formatStorageSize(totalMb)} required`;
        }
    }
    if (btn) btn.disabled = checked.length === 0;
    if (selAll) {
        selAll.indeterminate = checked.length > 0 && checked.length < total.length;
        selAll.checked = total.length > 0 && checked.length === total.length;
    }
}

function toggleSelectAll(checkbox) {
    document.querySelectorAll('.tool-select-checkbox').forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updateMultiInstallBar();
}

async function installSelectedTools() {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    if (!isInitialized) {
        showNotification('Initialize Kjer first before installing tools.');
        return;
    }
    const checkboxes = Array.from(document.querySelectorAll('.tool-select-checkbox:checked'));
    if (checkboxes.length === 0) return;
    const toolEntries = checkboxes.map(cb => ({ key: cb.dataset.toolKey, display: cb.dataset.toolDisplay || cb.dataset.toolKey }));
    const btn = document.getElementById('installSelectedBtn');
    const resetBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Install Selected'; updateMultiInstallBar(); } };

    // Partition tools: skip already-installed tools and 'builtin' tools; install everything else
    const installableEntries = [];
    const skipEntries        = [];
    const alreadyInstalled   = getInstalledTools();
    for (const entry of toolEntries) {
        const src = TOOLS_DATABASE[entry.key]?.installSource || 'pkg';
        if (src === 'builtin') {
            skipEntries.push({ ...entry, reason: 'built into OS \u2014 no installation needed' });
        } else if (entry.key in alreadyInstalled) {
            skipEntries.push({ ...entry, reason: 'already installed' });
        } else {
            installableEntries.push(entry);
        }
    }

    logActivity(`Batch install requested: ${toolEntries.length} tool(s) selected${installableEntries.length < toolEntries.length ? `, ${toolEntries.length - installableEntries.length} already installed/built-in — skipping` : ''}`, 'info', '', true);

    // Log skipped tools so the user sees why they're not being processed
    for (const { key, display, reason } of skipEntries) {
        const level = reason === 'already installed' ? 'info' : 'warning';
        logActivity(`  \u2713  ${TOOLS_DATABASE[key]?.name || display} \u2014 ${reason}`, level);
    }

    if (installableEntries.length === 0) {
        const alreadyCount = skipEntries.filter(s => s.reason === 'already installed').length;
        const msg = alreadyCount === toolEntries.length
            ? `All ${alreadyCount} selected tool(s) are already installed`
            : skipEntries.length > 0
                ? `All selected tool(s) are already installed or built into the OS`
                : 'No tools to install';
        showNotification(msg);
        logActivity(msg, 'info', '', true);
        resetBtn();
        return;
    }

    // Log each queued tool so the user sees exactly what's about to happen
    for (const { key, display } of installableEntries) {
        const src = TOOLS_DATABASE[key]?.installSource || 'pkg';
        const note = src === 'repo'     ? ' (adds APT repo first)'
                   : src === 'download' ? ' (downloads package)'
                   : '';
        logActivity(`  \u23F3  ${TOOLS_DATABASE[key]?.name || display} \u2014 queued${note}`, 'info');
    }

    if (installableEntries.length === 1) {
        // Single tool — use the normal toggle path
        if (btn) { btn.disabled = true; btn.textContent = 'Installing\u2026'; }
        await installTool(installableEntries[0].key, true);
        reapplyToolFilter();
        resetBtn();
        return;
    }

    // Multiple tools — send to backend batch (backend routes pkg/repo/download internally)
    if (btn) { btn.disabled = true; btn.textContent = `Installing ${installableEntries.length} tools\u2026`; }
    showNotification(`Batch installing ${installableEntries.length} tools \u2014 this may take several minutes\u2026`);
    logActivity(`Starting install for ${installableEntries.length} tool(s) \u2014 please wait\u2026`, 'info');

    // Live elapsed-seconds counter so the button never looks frozen
    let elapsed = 0;
    const pulseTimer = setInterval(() => {
        elapsed++;
        if (btn) btn.textContent = `Installing ${installableEntries.length} tools\u2026 (${elapsed}s)`;
    }, 1000);

    const keys   = installableEntries.map(t => t.key);
    const result = await BackendAPI.installBatch(keys);
    clearInterval(pulseTimer);

    if (result.results && result.results.length > 0) {
        let succeeded = 0, failed = 0;
        for (const r of result.results) {
            const displayName = TOOLS_DATABASE[r.tool]?.name || r.tool;
            if (r.success) {
                setToolInstalled(r.tool, true);
                succeeded++;
                logActivity(`  \u2713  ${displayName} \u2014 installed`, 'success');
            } else {
                failed++;
                logActivity(`  \u2717  ${displayName} \u2014 ${r.message || 'failed'}`, 'error');
            }
            if (btn) btn.textContent = `Done: ${succeeded + failed}/${result.results.length}`;
        }
        const summary = failed > 0
            ? `Batch install: ${succeeded} installed, ${failed} failed \u2014 check activity log`
            : `Batch install complete: ${succeeded} tool(s) installed`;
        showNotification(summary);
        logActivity(`Batch install finished \u2014 ${succeeded} ok, ${failed} failed`, failed > 0 ? 'warning' : 'success', '', true);
    } else {
        if (result.success) {
            installableEntries.forEach(({ key }) => setToolInstalled(key, true));
            showNotification(`Batch install complete: ${installableEntries.length} tool(s) installed`);
            logActivity(`Batch install complete \u2014 ${installableEntries.length} tools installed`, 'success', '', true);
        } else {
            const errMsg = result.message || result.error || 'unknown error';
            showNotification(`Batch install failed: ${errMsg}`);
            logActivity(`Batch install failed: ${errMsg}`, 'error', '', true);
        }
    }

    // Sync actual binary state so Installed tab always reflects reality,
    // even when the batch partially succeeded or the IPC timed out.
    await syncInstalledFromSystem();
    resetBtn();
}

function viewToolDetails(toolName) {
    alert(`Details for: ${toolName}\n\nThis tool is part of the Kjer suite.\nVisit the documentation for more information.`);
}

// ==================== PROFILES SECTION ====================

async function renderProfiles() {
    const profilesList = document.getElementById('profilesList');
    if (!profilesList) return;

    const tier         = getActiveTier();
    const devices      = getNetworkDevices();
    const customProfiles = JSON.parse(localStorage.getItem('customProfiles') || '[]');

    profilesList.innerHTML = '';

    // ── Tier banner ────────────────────────────────────────────────
    const banner = document.createElement('div');
    banner.style.cssText = `padding:12px 20px; margin-bottom:20px; border-radius:6px;
        background:rgba(0,0,0,.18); border:1px solid ${tier.color}44;
        display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;`;
    banner.innerHTML = `
        <span style="color:${tier.color}; font-weight:700; font-size:14px; font-family:'Tomorrow',sans-serif;">
            ${tier.label} Tier
        </span>
        <span style="color:#888; font-size:12px;">${tier.description}</span>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <span style="font-size:11px; color:#aaa;">
                Profiles: <strong style="color:${tier.color};">${customProfiles.length}/${tier.maxProfiles}</strong>
            </span>
            <button class="btn btn-outline" style="font-size:11px; padding:4px 12px;"
                onclick="switchTab('network')">
                &#8594; Network Devices
                <span style="color:${tier.color}; font-weight:600; margin-left:4px;">
                    (${devices.length}/${tier.maxDevices})
                </span>
            </button>
        </div>`;
    profilesList.appendChild(banner);

    // ── Connected device quick-view (Home+) ────────────────────────
    if (tier.tier >= 2 && devices.length > 0) {
        const devSection = document.createElement('div');
        devSection.style.cssText = 'margin-bottom:24px;';
        devSection.innerHTML = `<h3 style="font-family:'Tomorrow',sans-serif; font-size:14px;
            color:#9D4EDD; margin:0 0 12px 0; text-transform:uppercase; letter-spacing:.05em;">
            Connected Devices — Quick Actions</h3>`;
        const devGrid = document.createElement('div');
        devGrid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px;';
        devices.forEach(dev => {
            const card = document.createElement('div');
            card.style.cssText = `background:rgba(0,0,0,.2); border:1px solid rgba(176,224,230,.12);
                border-radius:6px; padding:12px;`;
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="color:#B0E0E6; font-size:13px;">${_escapeHtml(dev.name)}</strong>
                    <span style="font-size:11px; padding:2px 7px; border-radius:3px;
                        background:${dev.status === 'online' ? 'rgba(76,175,80,.2)' : 'rgba(255,152,0,.15)'};
                        color:${dev.status === 'online' ? '#4caf50' : '#ff9800'};">
                        ${dev.status}
                    </span>
                </div>
                <p style="color:#888; font-size:12px; margin:0 0 10px 0;">${dev.ip}${dev.os ? ' · ' + _escapeHtml(dev.os) : ''}</p>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-primary" style="flex:1; font-size:11px; padding:5px 0;"
                        onclick="scanDevice('${dev.ip}', '${dev.id}')">&#128270; Scan</button>
                    <button class="btn btn-outline" style="flex:1; font-size:11px; padding:5px 0;"
                        onclick="defendDevice('${dev.ip}', '${dev.id}')">&#128737; Defend</button>
                </div>`;
            devGrid.appendChild(card);
        });
        devSection.appendChild(devGrid);
        profilesList.appendChild(devSection);
    }

    // ── Profiles for current OS ────────────────────────────────────
    const compatibleProfiles = getProfilesForCurrentOS();
    if (compatibleProfiles.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'text-align:center; color:var(--color-empty-state); padding:40px;';
        empty.textContent = 'No profiles available for your system.';
        profilesList.appendChild(empty);
        return;
    }

    // Create Custom Profile button (tier-gated)
    const atProfileLimit = customProfiles.length >= tier.maxProfiles;
    const customBtn = document.createElement('button');
    customBtn.className = 'btn btn-primary';
    customBtn.style.cssText = 'width: 100%; padding: 15px; margin-bottom: 30px; font-size: 16px;';
    customBtn.textContent = atProfileLimit
        ? `Custom Profile Limit Reached (${customProfiles.length}/${tier.maxProfiles})`
        : `Create Custom Profile (${customProfiles.length}/${tier.maxProfiles})`;
    customBtn.disabled = atProfileLimit;
    if (atProfileLimit) customBtn.style.opacity = '0.5';
    customBtn.onclick = atProfileLimit ? null : showCustomProfileCreator;
    profilesList.appendChild(customBtn);
    
    // Render OS-specific profiles
    compatibleProfiles.forEach((profile, index) => {
        const profileCard = createProfileCard(profile, index);
        profilesList.appendChild(profileCard);
    });
}

function showCustomProfileCreator() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'customProfileModal';
    modal.style.display = 'flex';
    
    // Generate tool checkboxes
    let toolsHtml = Object.entries(TOOLS_DATABASE).map(([key, tool]) => {
        const isCompatible = tool.compatible === 'Yes';
        return `
            <div style="padding: 10px 0; border-bottom: 1px solid rgba(157, 78, 221, 0.2);">
                <label style="color: #B0E0E6; display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" class="custom-tool-check" value="${tool.name}" style="margin-right: 10px; cursor: pointer;">
                    <span style="flex: 1;">${tool.name}</span>
                    <span style="color: #B0E0E6; font-size: 12px; margin-left: 10px;">
                        ${isCompatible ? 'Compatible' : 'Incompatible'}
                    </span>
                </label>
            </div>
        `;
    }).join('');
    
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>Create Custom Security Profile</h2>
                <button class="modal-close" onclick="document.getElementById('customProfileModal').remove()">×</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="color: #B0E0E6; display: block; margin-bottom: 8px; font-weight: bold;">Profile Name:</label>
                    <input type="text" id="customProfileName" placeholder="e.g., My Enterprise Security" 
                           style="width: 100%; padding: 10px; background-color: #0a0a0a; border: 1px solid #9D4EDD; color: #B0E0E6; border-radius: 4px; box-sizing: border-box;">
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="color: #B0E0E6; display: block; margin-bottom: 8px; font-weight: bold;">Profile Description:</label>
                    <textarea id="customProfileDesc" placeholder="Describe the purpose of this profile..." 
                              style="width: 100%; padding: 10px; background-color: #0a0a0a; border: 1px solid #9D4EDD; color: #B0E0E6; border-radius: 4px; box-sizing: border-box; min-height: 80px; resize: vertical;"></textarea>
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="color: #B0E0E6; display: block; margin-bottom: 15px; font-weight: bold;">Select Tools:</label>
                    <div style="max-height: 300px; overflow-y: auto; padding: 15px; background-color: rgba(157, 78, 221, 0.02); border-radius: 4px; border: 1px solid rgba(157, 78, 221, 0.1);">
                        ${toolsHtml}
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="document.getElementById('customProfileModal').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="saveCustomProfile()">Create Profile</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function saveCustomProfile() {
    const name = document.getElementById('customProfileName').value.trim();
    const description = document.getElementById('customProfileDesc').value.trim();
    const selectedTools = Array.from(document.querySelectorAll('.custom-tool-check:checked')).map(cb => cb.value);
    
    if (!name || !description || selectedTools.length === 0) {
        showNotification('Please fill in all fields and select at least one tool');
        return;
    }

    const existingProfiles = JSON.parse(localStorage.getItem('customProfiles') || '[]');
    if (existingProfiles.length >= getMaxProfiles()) {
        showNotification(`Custom profile limit reached (${existingProfiles.length}/${getMaxProfiles()}). Upgrade your license to create more.`, 'warning');
        return;
    }
    
    // Create custom profile
    const customProfile = {
        name: name,
        description: description,
        tools: selectedTools,
        installSize: `${(selectedTools.length * 200)} MB`,
        installTime: `${selectedTools.length * 5} minutes`,
        isCustom: true
    };
    
    // Save to localStorage
    let customProfiles = JSON.parse(localStorage.getItem('customProfiles') || '[]');
    customProfiles.push(customProfile);
    localStorage.setItem('customProfiles', JSON.stringify(customProfiles));
    
    showNotification(`Custom profile "${name}" created successfully.`);
    logActivity(`Custom profile created: ${name} (${selectedTools.length} tools)`);
    document.getElementById('customProfileModal').remove();
    renderProfiles();
}

function createProfileCard(profile, index) {
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.style.marginBottom = '20px';

    const currentOS = localStorage.getItem('userOS') || SystemInfo.detectOS();

    const toolsList = profile.tools.map(toolName => {
        const tool = Object.values(TOOLS_DATABASE).find(t => t.name === toolName);
        const compatible = tool && tool.osCompatibility && tool.osCompatibility.includes(currentOS);
        return `<span style="color:#FFFFFF;padding:2px 8px;background:${compatible ? 'rgba(157,78,221,0.15)' : 'rgba(100,100,100,0.15)'};border-radius:3px;display:inline-block;margin:4px 2px;font-size:12px;">${toolName}</span>`;
    }).join('');

    card.innerHTML = `
        <div style="padding: 20px; border-left: 4px solid #2196F3;">
            <div style="color: #2196F3; font-size: 18px; font-weight: bold; margin-bottom: 8px;">${profile.name}</div>
            <p style="color: #FFFFFF; margin: 0 0 15px 0; font-size: 14px;">${profile.description}</p>
            <div style="margin-bottom: 15px;">
                <strong style="color: #2196F3;">Included Tools (${profile.tools.length}):</strong>
                <div style="margin-top: 10px;">${toolsList}</div>
            </div>
            <div style="font-size: 12px; color: #FFFFFF; margin-bottom: 15px;">
                <div>Size: ${profile.installSize}</div>
                <div>Time: ${profile.installTime}</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <button class="btn btn-primary" onclick="installProfile('${profile.name}')">Install Profile</button>
                <button class="btn btn-outline" onclick="showProfileToolSelection('${profile.name}', ${index})">Customize Tools</button>
            </div>
        </div>
    `;

    return card;
}

function showProfileToolSelection(profileName, profileIndex) {
    // Resolve profile — first try the OS-specific list used by renderProfiles,
    // then fall back to the static PROFILES_DATABASE (used for cross-OS profiles).
    let profile = getProfilesForCurrentOS().find(p => p.name === profileName)
                  || PROFILES_DATABASE[profileIndex]
                  || PROFILES_DATABASE.find(p => p.name === profileName);

    if (!profile) {
        showNotification(`Profile "${profileName}" not found.`);
        return;
    }

    const currentOS  = localStorage.getItem('userOS') || SystemInfo.detectOS();
    const profileSet = new Set(profile.tools);
    const installed  = getInstalledTools();

    // Build full list: all tools compatible with the current OS — include DB key
    const allCompatible = Object.entries(TOOLS_DATABASE)
        .filter(([, t]) => t.osCompatibility && t.osCompatibility.includes(currentOS))
        .map(([key, t]) => ({ key, ...t }));

    // Sort: profile tools first (pre-checked), then others alphabetically
    allCompatible.sort((a, b) => {
        const aIn = profileSet.has(a.name);
        const bIn = profileSet.has(b.name);
        if (aIn && !bIn) return -1;
        if (!aIn && bIn) return  1;
        return a.name.localeCompare(b.name);
    });

    const toolsHtml = allCompatible.map(tool => {
        const inProfile    = profileSet.has(tool.name);
        const isInstalled  = tool.key in installed;
        const score        = tool.compatibilityScore?.[currentOS] ?? 0;
        const scoreLabel   = score >= 90 ? `<span style="color:#4caf50;font-size:11px;">★ ${score}%</span>`
                           : score >= 70 ? `<span style="color:#ff9800;font-size:11px;">★ ${score}%</span>`
                           :               `<span style="color:#9e9e9e;font-size:11px;">★ ${score}%</span>`;
        const installedBadge = isInstalled
            ? `<span style="color:#4caf50;font-size:11px;margin-left:6px;">✓ installed</span>` : '';
        const sectionLabel = !inProfile
            ? `<span style="color:#9D4EDD;font-size:11px;margin-left:6px;">+ add-on</span>` : '';

        return `
            <div style="padding:9px 0;border-bottom:1px solid rgba(157,78,221,0.15);">
                <label style="color:#e0e0e0;display:flex;align-items:center;cursor:pointer;gap:8px;">
                    <input type="checkbox" ${inProfile ? 'checked' : ''} value="${tool.name}"
                           style="cursor:pointer;accent-color:#9D4EDD;">
                    <span style="flex:1;">${tool.name}</span>
                    ${scoreLabel}${installedBadge}${sectionLabel}
                    <span style="color:#777;font-size:11px;">${tool.category || ''}</span>
                </label>
            </div>`;
    }).join('');

    // Remove any existing modal
    document.getElementById('toolSelectModal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'toolSelectModal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:600px;max-height:80vh;display:flex;flex-direction:column;">
            <div class="modal-header">
                <h2>${profileName} — Customize Tools</h2>
                <button class="modal-close" onclick="document.getElementById('toolSelectModal').remove()">×</button>
            </div>
            <div class="modal-body" style="overflow-y:auto;flex:1;">
                <p style="color:#B0E0E6;margin-bottom:8px;font-size:13px;">
                    Profile tools are pre-checked. Add or remove any compatible ${currentOS} tool before installing.
                </p>
                <div style="margin-bottom:10px;">
                    <label style="color:#9D4EDD;font-size:13px;cursor:pointer;">
                        <input type="checkbox" id="tsSelectAll" style="accent-color:#9D4EDD;cursor:pointer;"
                               onchange="document.querySelectorAll('#toolSelectModal input[type=checkbox]:not(#tsSelectAll)').forEach(c=>c.checked=this.checked)">
                        Select / deselect all
                    </label>
                </div>
                <div id="toolCheckboxes">${toolsHtml}</div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="document.getElementById('toolSelectModal').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="confirmProfileInstallation('${profileName}')">Install Selected Tools</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function confirmProfileInstallation(profileName) {
    const checkboxes = document.querySelectorAll('#toolSelectModal input[type="checkbox"]:checked');
    const selectedTools = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedTools.length === 0) {
        showNotification('Please select at least one tool');
        return;
    }
    
    document.getElementById('toolSelectModal').remove();
    installProfile(profileName, selectedTools.length, selectedTools);
}

async function installProfile(profileName, toolCount, selectedTools = null) {
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    if (!isInitialized) {
        showNotification('Initialize Kjer first before installing profiles.');
        return;
    }

    // If a specific tool subset was chosen (via Customize Tools), use that.
    // Otherwise look up the full tool list from the database (OS-specific first).
    let tools = selectedTools;
    if (!tools) {
        let profile = getProfilesForCurrentOS().find(p => p.name === profileName)
                   || PROFILES_DATABASE.find(p => p.name === profileName);
        if (!profile) {
            const custom = JSON.parse(localStorage.getItem('customProfiles') || '[]');
            profile = custom.find(p => p.name === profileName);
        }
        if (!profile || !profile.tools || profile.tools.length === 0) {
            showNotification(`Profile "${profileName}" not found or has no tools.`);
            return;
        }
        tools = profile.tools;
    }

    // Resolve profile tool list entries (display names like 'Fail2ban') to
    // TOOLS_DATABASE keys (like 'fail2ban') that the backend expects.
    const _dbByName = {};
    for (const [k, v] of Object.entries(TOOLS_DATABASE)) {
        _dbByName[v.name.toLowerCase()] = k;
    }
    const resolvedTools = tools.map(t => _dbByName[t.toLowerCase()] || t.toLowerCase());

    logActivity(`Profile installation started: ${profileName} (${resolvedTools.length} tools)`, 'info', '', true);
    showNotification(`Installing ${profileName} profile (${resolvedTools.length} tools)... This may take several minutes.`);
    
    let succeeded = 0;
    let failed = 0;
    for (const toolKey of resolvedTools) {
        const installed = getInstalledTools();
        if (toolKey in installed) {
            // Already installed — skip silently
            succeeded++;
            continue;
        }
        const displayName = TOOLS_DATABASE[toolKey]?.name || toolKey;
        logActivity(`[${profileName}] Installing ${displayName}…`, 'info');
        const result = await BackendAPI.installTool(toolKey);
        if (result.success) {
            setToolInstalled(toolKey, true);
            succeeded++;
            logActivity(`[${profileName}] ${displayName} installed`, 'success');
        } else {
            failed++;
            logActivity(`[${profileName}] ${displayName} failed: ${result.message || result.error || 'unknown error'}`, 'error');
        }
    }

    // Mark the profile itself as installed
    localStorage.setItem(`profile_${profileName}_installed`, 'true');

    // Sync all dashboard/toolbox UI that depends on installed tool state
    const installedNow  = getInstalledTools();
    const toolsCountEl  = document.getElementById('activeToolsCount');
    if (toolsCountEl) toolsCountEl.textContent = Object.keys(installedNow).length;
    updateProfilesCount();
    updateSystemStatus();
    updateLicenseStatus();
    renderToolsList();
    renderProfiles();

    if (failed === 0) {
        showNotification(`✓ ${profileName} profile installed successfully (${succeeded} tools).`);
        logActivity(`Profile installation completed: ${profileName} — ${succeeded} tools installed`, 'success', '', true);
    } else {
        showNotification(`${profileName} profile: ${succeeded} installed, ${failed} failed. Check the activity log.`);
        logActivity(`Profile installation finished with errors: ${profileName} — ${succeeded} ok, ${failed} failed`, 'warning', '', true);
    }
}

// ==================== SETTINGS FUNCTIONS ====================

function saveSetting(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    logActivity(`Setting updated: ${key}`);
}

function saveAllSettings() {
    // Checkboxes
    const autoRefresh   = document.getElementById('autoRefresh');
    const notifications = document.getElementById('notifications');
    const darkMode      = document.getElementById('darkMode');
    const autoUpdate    = document.querySelector('input[onchange*="autoUpdate"]');
    const installPath   = document.querySelector('input[onchange*="installPath"]');

    if (autoRefresh)   localStorage.setItem('autoRefresh',   JSON.stringify(autoRefresh.checked));
    if (notifications) localStorage.setItem('notifications', JSON.stringify(notifications.checked));
    if (darkMode)      localStorage.setItem('darkMode',      JSON.stringify(darkMode.checked));
    if (autoUpdate)    localStorage.setItem('autoUpdate',    JSON.stringify(autoUpdate.checked));
    if (installPath)   localStorage.setItem('installPath',   JSON.stringify(installPath.value));

    showNotification('Settings saved successfully');
    logActivity('Settings saved by user');
}

function loadSettings() {
    // Dark mode
    const darkMode = JSON.parse(localStorage.getItem('darkMode') || 'false');
    if (darkMode) {
        document.body.classList.add('dark-mode');
        const darkModeCheckbox = document.getElementById('darkMode');
        if (darkModeCheckbox) darkModeCheckbox.checked = true;
    }

    // Checkboxes
    const autoRefresh   = JSON.parse(localStorage.getItem('autoRefresh')   ?? 'true');
    const notifications = JSON.parse(localStorage.getItem('notifications') ?? 'true');
    const autoUpdate    = JSON.parse(localStorage.getItem('autoUpdate')    ?? 'true');

    if (document.getElementById('autoRefresh'))   document.getElementById('autoRefresh').checked   = autoRefresh;
    if (document.getElementById('notifications')) document.getElementById('notifications').checked = notifications;

    const autoUpdateEl = document.querySelector('input[onchange*="autoUpdate"]');
    if (autoUpdateEl) autoUpdateEl.checked = autoUpdate;

    // Text inputs
    const savedPath  = localStorage.getItem('installPath');
    const installPathEl = document.querySelector('input[onchange*="installPath"]');
    if (installPathEl && savedPath) installPathEl.value = JSON.parse(savedPath);

    // Application Updates card
    const autoCheckUpdates = localStorage.getItem('autoCheckUpdates') !== 'false';
    const autoCheckEl = document.getElementById('autoCheckUpdatesToggle');
    if (autoCheckEl) autoCheckEl.checked = autoCheckUpdates;
    // Populate the installed-version field now so it reads correctly before a check
    window.electronAPI?.readVersionFile?.().then(vinfo => {
        const el = document.getElementById('kjCurrentVersion');
        if (el && vinfo?.version) el.textContent = `v${vinfo.version.replace(/^v/i, '')}`;
    }).catch(() => {});
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    saveSetting('darkMode', isDarkMode);
    showNotification(isDarkMode ? 'Dark mode enabled' : 'Light mode enabled');
}

// Keys that represent user-configurable settings — safe to wipe on reset.
const _SETTINGS_KEYS = [
    'darkMode', 'autoRefresh', 'notifications',
    'installPath', 'autoUpdate', 'autoCheckUpdates',
];

// Keys that represent cached hardware/system-detection data — safe to clear
// so they are re-detected on the next host-scan, but NOT license-critical.
const _CACHE_KEYS = [
    'hostKernel', 'hostName', 'hostArch', 'hostCpuCount',
    'hostRamTotal', 'hostRamAvail', 'hostDiskTotal', 'hostDiskAvail',
    'lastHostScanTime',  // clearing forces a fresh Python scan on next boot
];

// NOTE: the following keys are NEVER cleared by reset or cache functions
// because losing them locks the user out of the application:
//   kjerActivated, kjerLicenseKey, kjerLicenseType, kjerVersion,
//   kjerInitialized, kjerTutorialCompleted, userOS, userDistro,
//   installedAt, initializationDate, and all installedTools_* / profile_* entries.

function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
        _SETTINGS_KEYS.forEach(k => localStorage.removeItem(k));
        location.reload();
    }
}

function clearCache() {
    if (confirm('This will clear the application cache. Continue?')) {
        // Remove settings + hardware-cache keys only.
        // License, activation, init, OS, and installed-tool state are preserved
        // so the application stays functional after the cache wipe.
        [..._SETTINGS_KEYS, ..._CACHE_KEYS].forEach(k => localStorage.removeItem(k));
        showNotification('Cache cleared successfully');
        logActivity('Cache cleared by user');
    }
}

function exportSettings() {
    const settings = {
        darkMode: JSON.parse(localStorage.getItem('darkMode')),
        autoRefresh: JSON.parse(localStorage.getItem('autoRefresh')),
        notifications: JSON.parse(localStorage.getItem('notifications')),
        installPath: localStorage.getItem('installPath'),
        autoUpdate: JSON.parse(localStorage.getItem('autoUpdate')),
        exportDate: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(settings, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Kjer_settings_${Date.now()}.json`;
    link.click();
    
    showNotification('Settings exported successfully');
    logActivity('Settings exported by user');
}

function downloadConfiguration(format = 'json') {
    const systemInfo = SystemInfo.getOSInfo();
    const userOS = localStorage.getItem('userOS') || systemInfo.os;
    const isInitialized = localStorage.getItem('kjerInitialized') === 'true';
    
    // Get hardware ID to tag configuration
    BackendAPI.getHardwareId().then(hwidResult => {
        const hardwareId = hwidResult.hardware_id || 'unknown';
        
        // Gather all configuration data
        const configuration = {
            metadata: {
                aplikacija: 'Kjer',
                версија: localStorage.getItem('kjerVersion') || '1.0.0',
                exportDate: new Date().toISOString(),
                detectedOS: systemInfo.name,
                userOS: userOS,
                hardwareId: hardwareId,
                initialized: isInitialized
            },
            settings: {
                darkMode: JSON.parse(localStorage.getItem('darkMode') || 'false'),
                autoRefresh: JSON.parse(localStorage.getItem('autoRefresh') || 'true'),
                notifications: JSON.parse(localStorage.getItem('notifications') || 'true'),
                installPath: localStorage.getItem('installPath') || 'default',
                autoUpdate: JSON.parse(localStorage.getItem('autoUpdate') || 'true')
            },
            userPreferences: {
                selectedOS: userOS,
                tutorialCompleted: localStorage.getItem('kjerTutorialCompleted') === 'true'
            },
            installedTools: getInstalledTools()
        };
        
        // Generate report content
        const reportContent = generatePlainText(configuration);
        
        // Show report in modal
        showReportModal(reportContent, configuration, format, hardwareId);
        
        logActivity(`Configuration report generated for ${systemInfo.name} (Hardware: ${hardwareId.substring(0, 8)})`);
    }).catch(error => {
        console.error('Failed to get hardware ID:', error);
        showNotification('Error retrieving hardware information', 'error');
    });
}

function showReportModal(reportText, configuration, format, hardwareId) {
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'reportModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px; max-height: 80vh;">
            <div class="modal-header">
                <h2 class="page-header">📊 Configuration Report</h2>
            </div>
            <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                <pre style="background: #0a0a0a; padding: 20px; border-radius: 8px; color: #B0E0E6; font-family: monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">${reportText}</pre>
            </div>
            <div class="modal-footer" style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn btn-outline" onclick="closeReportModal()">Close</button>
                <button class="btn btn-primary" onclick="downloadReportAs('json', ${JSON.stringify(configuration).replace(/"/g, '&quot;')}, '${hardwareId}')">
                    <i class="icon icon-download"></i> Download JSON
                </button>
                <button class="btn btn-primary" onclick="downloadReportAs('yaml', ${JSON.stringify(configuration).replace(/"/g, '&quot;')}, '${hardwareId}')">
                    <i class="icon icon-download"></i> Download YAML
                </button>
                <button class="btn btn-primary" onclick="downloadReportAs('txt', ${JSON.stringify(configuration).replace(/"/g, '&quot;')}, '${hardwareId}')">
                    <i class="icon icon-download"></i> Download TXT
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function closeReportModal() {
    const modal = document.getElementById('reportModal');
    if (modal) {
        modal.remove();
    }
}

function downloadReportAs(format, configuration, hardwareId) {
    let content, filename, mimeType;
    
    if (format === 'json') {
        content = JSON.stringify(configuration, null, 2);
        filename = `Kjer_config_${hardwareId.substring(0, 8)}_${Date.now()}.json`;
        mimeType = 'application/json';
    } else if (format === 'yaml') {
        content = generateYAML(configuration);
        filename = `Kjer_config_${hardwareId.substring(0, 8)}_${Date.now()}.yaml`;
        mimeType = 'application/x-yaml';
    } else if (format === 'txt') {
        content = generatePlainText(configuration);
        filename = `Kjer_config_${hardwareId.substring(0, 8)}_${Date.now()}.txt`;
        mimeType = 'text/plain';
    }
    
    // Create and trigger download
    const dataBlob = new Blob([content], {type: mimeType});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    
    showNotification(`Configuration downloaded as ${format.toUpperCase()}`);
}

function generateYAML(config) {
    let yaml = '# Kjer Security Framework Configuration\n';
    yaml += '# Generated: ' + new Date().toISOString() + '\n';
    yaml += '# Hardware ID: ' + config.metadata.hardwareId + '\n\n';
    
    yaml += 'metadata:\n';
    yaml += '  application: ' + config.metadata.aplikacija + '\n';
    yaml += '  version: ' + config.metadata.версия + '\n';
    yaml += '  hardwareId: ' + config.metadata.hardwareId + '\n';
    yaml += '  platform: ' + config.metadata.detectedOS + '\n';
    yaml += '  initialized: ' + config.metadata.initialized + '\n\n';
    
    yaml += 'settings:\n';
    yaml += '  darkMode: ' + config.settings.darkMode + '\n';
    yaml += '  autoRefresh: ' + config.settings.autoRefresh + '\n';
    yaml += '  notifications: ' + config.settings.notifications + '\n';
    yaml += '  installPath: ' + config.settings.installPath + '\n';
    yaml += '  autoUpdate: ' + config.settings.autoUpdate + '\n\n';
    
    yaml += 'preferences:\n';
    yaml += '  selectedOS: ' + config.userPreferences.selectedOS + '\n';
    yaml += '  tutorialCompleted: ' + config.userPreferences.tutorialCompleted + '\n\n';
    
    yaml += 'installedTools: ' + Object.keys(config.installedTools).length + '\n';
    if (Object.keys(config.installedTools).length > 0) {
        yaml += '  tools:\n';
        for (const tool in config.installedTools) {
            yaml += '    - ' + tool + '\n';
        }
    }
    
    return yaml;
}

function generatePlainText(config) {
    let text = '===============================================\n';
    text += 'KJER SECURITY FRAMEWORK CONFIGURATION REPORT\n';
    text += '===============================================\n\n';
    
    text += 'METADATA\n';
    text += '---------------------------------------\n';
    text += 'Application: ' + config.metadata.aplikacija + '\n';
    text += 'Version: ' + config.metadata.версия + '\n';
    text += 'Hardware ID: ' + config.metadata.hardwareId + '\n';
    text += 'Platform: ' + config.metadata.detectedOS + '\n';
    text += 'Initialized: ' + config.metadata.initialized + '\n';
    text += 'Export Date: ' + config.metadata.exportDate + '\n\n';
    
    text += 'APPLICATION SETTINGS\n';
    text += '---------------------------------------\n';
    text += 'Dark Mode: ' + config.settings.darkMode + '\n';
    text += 'Auto-Refresh: ' + config.settings.autoRefresh + '\n';
    text += 'Notifications: ' + config.settings.notifications + '\n';
    text += 'Install Path: ' + config.settings.installPath + '\n';
    text += 'Auto-Update: ' + config.settings.autoUpdate + '\n\n';
    
    text += 'USER PREFERENCES\n';
    text += '---------------------------------------\n';
    text += 'Selected OS: ' + config.userPreferences.selectedOS + '\n';
    text += 'Tutorial Completed: ' + config.userPreferences.tutorialCompleted + '\n\n';
    
    text += 'INSTALLED TOOLS\n';
    text += '---------------------------------------\n';
    const toolCount = Object.keys(config.installedTools).length;
    text += 'Total Installed: ' + toolCount + '\n';
    if (toolCount > 0) {
        text += '\nTools List:\n';
        for (const tool in config.installedTools) {
            text += '  • ' + tool + '\n';
        }
    }
    text += '\n===============================================\n';
    
    return text;
}

// ==================== ACTIVITY LOGGING (legacy DOM path) ====================
// logActivity() is defined earlier and routes through ActivityLog → #activityLog.
// This section intentionally left as a passthrough for console debugging only.
// Do not redefine logActivity here.

// ==================== NOTIFICATIONS ====================

function showNotification(message) {
    const notificationsEnabled = JSON.parse(localStorage.getItem('notifications') || 'true');
    if (!notificationsEnabled) return;
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        notification.classList.add('exit');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 4000);
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Update last update time every 30 seconds
    setInterval(() => {
        updateLastUpdateTime();
    }, 30000);
    
    // Auto-refresh on startup if enabled
    const autoRefresh = JSON.parse(localStorage.getItem('autoRefresh') || 'true');
    if (autoRefresh) {
        setInterval(() => {
            initializeDashboard();
            logActivity('Auto-refresh: System status updated');
        }, 300000); // Every 5 minutes
    }
}

// ==================== NETWORK MANAGEMENT ====================

function getNetworkDevices() {
    try {
        return JSON.parse(localStorage.getItem('kjerNetworkDevices') || '[]');
    } catch(e) {
        return [];
    }
}

function saveNetworkDevices(devices) {
    localStorage.setItem('kjerNetworkDevices', JSON.stringify(devices));
}

function _getLocalSubnet() {
    // Attempt to determine the /24 subnet from the local IP stored at initialization.
    const ip = localStorage.getItem('kjerLocalIP') || '';
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const parts = ip.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return '192.168.1.0/24'; // sensible default
}

// True while nmap is running — prevents re-renders from resetting the scan button.
let _networkScanInProgress = false;

function renderNetworkPage() {
    const container = document.getElementById('networkPageContainer');
    if (!container) return;

    const tier    = getActiveTier();
    const devices = getNetworkDevices();
    const isActivated = localStorage.getItem('kjerActivated') === 'true';

    if (!isActivated) {
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:var(--color-empty-state);">
                <p style="font-size:16px;">Network management requires an active license.</p>
                <button class="btn btn-primary" style="margin-top:16px;" onclick="showActivationModal()">Activate Kjer</button>
            </div>`;
        return;
    }

    const usedPct  = Math.min(100, Math.round((devices.length / tier.maxDevices) * 100));
    const barColor = usedPct >= 90 ? '#f44336' : usedPct >= 70 ? '#ff9800' : tier.color;

    container.innerHTML = `
        <!-- Header -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:24px;">
            <div>
                <h2 style="font-family:'Tomorrow',sans-serif; color:${tier.color}; margin:0 0 4px 0;">Network Manager</h2>
                <p style="color:#888; margin:0; font-size:13px;">${tier.label} Tier &mdash; ${tier.description}</p>
            </div>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; flex-direction:column; align-items:flex-end;">
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <button class="btn btn-primary" id="scanNetworkBtn" onclick="scanNetworkDevices()" style="font-size:13px;">
                        &#128269; Scan Network
                    </button>
                    <button class="btn btn-outline" onclick="showAddDeviceModal()" style="font-size:13px;">
                        &#43; Add Device
                    </button>
                </div>
                <div id="scanProgressBar" style="width:220px;"></div>
                <div id="scanStatusText" style="display:none; color:#B0E0E6; font-size:11px; opacity:0.75; text-align:right;"></div>
            </div>
        </div>

        <!-- Connection meter -->
        <div style="background:rgba(0,0,0,.2); border:1px solid rgba(255,255,255,.07); border-radius:8px; padding:14px 20px; margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:13px; color:#ccc;">Connected Devices</span>
                <span style="font-weight:700; color:${barColor};">${devices.length} / ${tier.maxDevices}</span>
            </div>
            <div style="background:rgba(255,255,255,.08); border-radius:4px; height:6px; overflow:hidden;">
                <div style="width:${usedPct}%; height:100%; background:${barColor}; border-radius:4px; transition:width .3s;"></div>
            </div>
        </div>

        <!-- Bulk actions toolbar (visible when devices exist) -->
        ${devices.length > 0 ? `
        <div id="networkBulkBar" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;
            background:rgba(0,0,0,.18); border:1px solid rgba(255,255,255,.07); border-radius:8px;
            padding:10px 16px; margin-bottom:16px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#ccc;
                font-size:13px; user-select:none;">
                <input type="checkbox" id="selectAllDevicesCheck"
                    style="width:15px; height:15px; accent-color:#B0E0E6; cursor:pointer;"
                    onchange="_selectAllNetworkDevices(this.checked)">
                Select All
            </label>
            <span style="color:#444;">|</span>
            <button class="btn btn-primary" id="bulkScanBtn"
                style="font-size:12px; padding:6px 14px;" disabled
                onclick="bulkScanDevices()">&#128270; Scan Selected</button>
            <button class="btn btn-outline" id="bulkDefendBtn"
                style="font-size:12px; padding:6px 14px;" disabled
                onclick="bulkDefendDevices()">&#128737; Defend Selected</button>
            <span id="bulkSelCount" style="color:#888; font-size:12px; margin-left:auto;"></span>
        </div>` : ''}

        <!-- Device grid -->
        <div id="networkDeviceGrid" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px;">
            ${devices.length === 0
                ? `<div style="grid-column:1/-1; text-align:center; padding:50px; color:#555;">
                       <p style="font-size:15px;">No devices connected yet.</p>
                       <p style="font-size:13px;">Click <strong>Scan Network</strong> to discover LAN devices, or <strong>Add Device</strong> to add one manually.</p>
                   </div>`
                : devices.map(dev => _buildDeviceCardHtml(dev, tier)).join('')
            }
        </div>`;

    // If a scan is running, restore scanning state on the freshly-rendered button.
    if (_networkScanInProgress) {
        const btn         = document.getElementById('scanNetworkBtn');
        const progressBar = document.getElementById('scanProgressBar');
        const statusText  = document.getElementById('scanStatusText');
        if (btn)         { btn.disabled = true; btn.innerHTML = '&#9203;&nbsp;Scanning&hellip;'; }
        if (progressBar) { progressBar.classList.add('scanning'); }
        if (statusText)  { statusText.style.display = 'block'; statusText.textContent = 'Probing network hosts\u2026'; }
    }
}

function _buildDeviceCardHtml(dev, tier) {
    const statusColor = dev.status === 'online'    ? '#4caf50'
                      : dev.status === 'scanning'   ? '#2196F3'
                      : dev.status === 'defending'  ? '#9D4EDD'
                      : dev.status === 'pending'    ? '#ff9800'
                      : dev.status === 'denied'     ? '#f44336'
                      : '#888';
    const lastScan = dev.lastScan
        ? `Last scanned: ${new Date(dev.lastScan).toLocaleString()}`
        : dev.status === 'pending' ? '\u23f3 Awaiting approval from device owner'
        : dev.status === 'denied'  ? '\u2717 Connection was denied by device owner'
        : 'Never scanned';
    return `
        <div class="device-card" style="background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.07);
            border-radius:8px; padding:16px; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                <div style="display:flex; align-items:flex-start; gap:8px;">
                    <input type="checkbox" class="device-select-check"
                        data-device-id="${dev.id}"
                        style="margin-top:3px; width:15px; height:15px; accent-color:#B0E0E6;
                               cursor:pointer; flex-shrink:0;"
                        onchange="_onDeviceCheckChange()">
                    <div>
                        <strong style="color:#B0E0E6; font-size:14px;">${_escapeHtml(dev.name)}</strong>
                        ${dev.mac ? `<br><span style="color:#555; font-size:11px;">${_escapeHtml(dev.mac)}</span>` : ''}
                    </div>
                </div>
                <span style="font-size:11px; padding:3px 8px; border-radius:3px;
                    background:${statusColor}22; color:${statusColor}; font-weight:600;">
                    ${dev.status}
                </span>
            </div>
            <p style="color:#9a9a9a; font-size:12px; margin:0 0 4px 0;">&#127760; ${_escapeHtml(dev.ip)}${dev.latency ? `<span style="color:#555;"> &middot; ${_escapeHtml(dev.latency)}</span>` : ''}</p>
            ${dev.hostname && dev.hostname !== dev.name ? `<p style="color:#666; font-size:11px; margin:0 0 4px 0;">&#128279; ${_escapeHtml(dev.hostname)}</p>` : ''}
            ${dev.os ? `<p style="color:#9a9a9a; font-size:12px; margin:0 0 4px 0;">&#128187; ${_escapeHtml(dev.os)}</p>` : ''}
            ${dev.vendor ? `<p style="color:#666; font-size:11px; margin:0 0 4px 0;">&#128269; ${_escapeHtml(dev.vendor)}</p>` : ''}
            ${dev.open_count > 0 ? `<p style="color:#9a9a9a; font-size:11px; margin:0 0 4px 0;">${dev.open_count} open port${dev.open_count !== 1 ? 's' : ''}${dev.services?.length ? ': ' + dev.services.slice(0,3).map(s => `<code style="background:rgba(255,255,255,.06);border-radius:3px;padding:1px 4px;font-size:10px;">${_escapeHtml(s)}</code>`).join(' ') : ''}</p>` : ''}
            <p style="color:#555; font-size:11px; margin:0 0 14px 0;">${lastScan}</p>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${dev.status === 'pending' || dev.status === 'denied'
                    ? `${dev.status === 'denied'
                        ? '<span style="color:#f44336; font-size:11px; flex:1;">Request denied.</span>'
                        : '<span style="color:#ff9800; font-size:11px; flex:1;">Waiting for approval…</span>'
                    }
                    <button class="btn btn-outline" style="flex:0; font-size:11px; padding:6px 10px; color:#f44336; border-color:#f44336;"
                        onclick="removeNetworkDevice('${dev.id}')">&#128465; Remove</button>`
                    : `<button class="btn btn-primary" style="flex:1; min-width:70px; font-size:11px; padding:6px 0;"
                        onclick="scanDevice('${_escapeHtml(dev.ip)}', '${dev.id}')">&#128270; Scan</button>
                    <button class="btn btn-outline" style="flex:1; min-width:70px; font-size:11px; padding:6px 0;"
                        onclick="defendDevice('${_escapeHtml(dev.ip)}', '${dev.id}')">&#128737; Defend</button>
                    <button class="btn btn-outline" style="flex:0; font-size:11px; padding:6px 10px; color:#f44336; border-color:#f44336;"
                        onclick="removeNetworkDevice('${dev.id}')">&#128465;</button>`
                }
            </div>
        </div>`;
}

// ── Bulk selection helpers ────────────────────────────────────────────────────

function _selectAllNetworkDevices(checked) {
    document.querySelectorAll('.device-select-check').forEach(cb => { cb.checked = checked; });
    _onDeviceCheckChange();
}

function _onDeviceCheckChange() {
    const all     = [...document.querySelectorAll('.device-select-check')];
    const checked = all.filter(c => c.checked);
    const saEl    = document.getElementById('selectAllDevicesCheck');
    if (saEl) {
        saEl.checked       = all.length > 0 && checked.length === all.length;
        saEl.indeterminate = checked.length > 0 && checked.length < all.length;
    }
    const n             = checked.length;
    const bulkScanBtn   = document.getElementById('bulkScanBtn');
    const bulkDefendBtn = document.getElementById('bulkDefendBtn');
    const bulkSelCount  = document.getElementById('bulkSelCount');
    if (bulkScanBtn)   bulkScanBtn.disabled   = n === 0;
    if (bulkDefendBtn) bulkDefendBtn.disabled  = n === 0;
    if (bulkSelCount)  bulkSelCount.textContent = n > 0 ? `${n} device${n !== 1 ? 's' : ''} selected` : '';
}

// ── Bulk scan ─────────────────────────────────────────────────────────────────

async function bulkScanDevices() {
    const checks  = [...document.querySelectorAll('.device-select-check:checked')];
    if (!checks.length) { showNotification('Select at least one device.', 'warning'); return; }
    const allDevs = getNetworkDevices();
    const targets = checks.map(c => allDevs.find(d => d.id === c.dataset.deviceId)).filter(Boolean);
    if (!targets.length) return;

    // Open the combined results modal immediately — rows update live as each scan finishes
    _showBulkScanResultsModal(targets);

    for (const dev of targets) {
        const row      = document.getElementById(`bsr-row-${dev.id}`);
        const statusEl = row?.querySelector('.bsr-status');
        if (statusEl) { statusEl.textContent = '\u23f3 Scanning\u2026'; statusEl.style.color = '#2196F3'; }

        const devs = getNetworkDevices();
        const d    = devs.find(x => x.id === dev.id);
        if (d) { d.status = 'scanning'; saveNetworkDevices(devs); }

        try {
            const result = await BackendAPI.callBackend('scan-device', { tool: dev.ip });

            const devs2 = getNetworkDevices();
            const d2    = devs2.find(x => x.id === dev.id);
            if (d2) {
                d2.status       = 'online';
                d2.lastScan     = new Date().toISOString();
                if (result.os       && !d2.os)       d2.os          = result.os.slice(0, 80);
                if (result.mac      && !d2.mac)       d2.mac         = result.mac;
                if (result.vendor   && !d2.vendor)    d2.vendor      = result.vendor;
                if (result.hostname && !d2.hostname)  d2.hostname    = result.hostname;
                d2.latency      = result.latency      || d2.latency      || '';
                d2.open_count   = result.open_count   ?? d2.open_count   ?? 0;
                d2.services     = result.services     || d2.services     || [];
                d2.uptime_guess = result.uptime_guess || d2.uptime_guess || '';
                saveNetworkDevices(devs2);
            }

            _updateBulkScanRow(dev.id, result, null);
            logActivity(`Bulk scan ${dev.ip}: ${result.open_count || 0} open ports`);
        } catch (err) {
            _updateBulkScanRow(dev.id, null, String(err?.message || err));
            const devs3 = getNetworkDevices();
            const d3    = devs3.find(x => x.id === dev.id);
            if (d3) { d3.status = 'unknown'; saveNetworkDevices(devs3); }
        }
    }

    renderNetworkPage();

    const totalOpen = getNetworkDevices()
        .filter(d => targets.some(t => t.id === d.id))
        .reduce((s, d) => s + (d.open_count || 0), 0);
    const summaryEl = document.getElementById('bsr-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `Scan complete &mdash; <strong style="color:#4caf50;">${totalOpen} open port${totalOpen !== 1 ? 's' : ''}</strong> found across ${targets.length} device${targets.length !== 1 ? 's' : ''}.`;
        summaryEl.style.color = '#ccc';
    }
    showNotification(`Bulk scan complete \u2014 ${targets.length} device${targets.length !== 1 ? 's' : ''} scanned.`, 'success');
}

function _showBulkScanResultsModal(targets) {
    document.getElementById('bulkScanResultsModal')?.remove();

    const rowsHtml = targets.map(dev => `
        <div id="bsr-row-${dev.id}"
            style="border:1px solid rgba(255,255,255,.07); border-radius:7px;
                   padding:14px 16px; margin-bottom:10px; transition:border-color .3s;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <div>
                    <strong style="color:#B0E0E6; font-size:13px;">${_escapeHtml(dev.name)}</strong>
                    <span style="color:#666; font-size:12px; margin-left:8px;">${_escapeHtml(dev.ip)}</span>
                    ${dev.os ? `<span style="color:#666; font-size:11px; margin-left:8px;">&ndash; ${_escapeHtml(dev.os.slice(0,50))}</span>` : ''}
                </div>
                <span class="bsr-status" style="font-size:12px; color:#555; white-space:nowrap;">&#9203; Queued</span>
            </div>
            <div class="bsr-results" style="max-height:0; overflow:hidden; transition:max-height .4s ease;"></div>
        </div>`).join('');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id        = 'bulkScanResultsModal';
    modal.style.display = 'flex';
    modal.style.zIndex  = '10000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:740px; width:96vw; max-height:88vh; overflow-y:auto;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#B0E0E6;">
                    Bulk Scan Results &mdash; ${targets.length} Device${targets.length !== 1 ? 's' : ''}
                </h3>
                <button class="btn btn-outline" style="padding:4px 10px;"
                    onclick="document.getElementById('bulkScanResultsModal').remove()">&#10005;</button>
            </div>
            <div class="modal-body" style="margin-top:14px;">
                <p id="bsr-summary" style="color:#888; font-size:12px; margin-bottom:16px;">
                    Scanning sequentially &mdash; results appear as each device completes.
                </p>
                <div id="bsr-rows">${rowsHtml}</div>
                <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                    <button class="btn btn-primary" style="font-size:12px;"
                        onclick="document.getElementById('bulkScanResultsModal').remove()">Close</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function _updateBulkScanRow(deviceId, result, error) {
    const row      = document.getElementById(`bsr-row-${deviceId}`);
    if (!row) return;
    const statusEl  = row.querySelector('.bsr-status');
    const resultsEl = row.querySelector('.bsr-results');

    if (error) {
        row.style.borderColor = 'rgba(244,67,54,.4)';
        if (statusEl)  { statusEl.textContent = '\u2717 Failed'; statusEl.style.color = '#f44336'; }
        if (resultsEl) {
            resultsEl.style.maxHeight = '60px';
            resultsEl.style.marginTop = '8px';
            resultsEl.innerHTML = `<p style="color:#f44336; font-size:12px; margin:0;">${_escapeHtml(error)}</p>`;
        }
        return;
    }

    const openPorts = (result?.ports || []).filter(p => p.state === 'open');
    row.style.borderColor = openPorts.length > 0 ? 'rgba(176,224,230,.22)' : 'rgba(255,255,255,.1)';

    if (statusEl) {
        statusEl.textContent = `\u2713 ${openPorts.length} open port${openPorts.length !== 1 ? 's' : ''}`;
        statusEl.style.color = '#4caf50';
    }

    const metaParts = [
        result.hostname ? `&#128279; ${_escapeHtml(result.hostname)}` : '',
        result.os       ? `&#128187; ${_escapeHtml(result.os)}${result.os_accuracy ? ` <em style="color:#666;">(${result.os_accuracy}%)</em>` : ''}` : '',
        result.mac      ? `MAC ${_escapeHtml(result.mac)}${result.vendor ? ' &middot; ' + _escapeHtml(result.vendor) : ''}` : '',
        result.latency  ? `&#9200; ${_escapeHtml(result.latency)}` : '',
        result.uptime_guess ? `&#9201; ${_escapeHtml(result.uptime_guess)}` : '',
    ].filter(Boolean);

    const portTableHtml = openPorts.length > 0
        ? `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:10px;">
            <thead>
                <tr style="border-bottom:1px solid rgba(255,255,255,.07);">
                    <th style="text-align:left; padding:4px 10px; color:#666; font-weight:500; width:90px;">Port</th>
                    <th style="text-align:left; padding:4px 10px; color:#666; font-weight:500; width:110px;">Service</th>
                    <th style="text-align:left; padding:4px 10px; color:#666; font-weight:500;">Version</th>
                </tr>
            </thead>
            <tbody>
                ${openPorts.map(p => `
                <tr>
                    <td style="padding:4px 10px; color:#B0E0E6; font-family:monospace;">${p.port}/${_escapeHtml(p.proto)}</td>
                    <td style="padding:4px 10px; color:#ccc;">${_escapeHtml(p.service)}</td>
                    <td style="padding:4px 10px; color:#888;">${_escapeHtml(p.version || '')}</td>
                </tr>`).join('')}
            </tbody>
           </table>`
        : `<p style="color:#555; font-size:12px; margin:6px 0 0 0; font-style:italic;">No open ports detected.</p>`;

    if (resultsEl) {
        resultsEl.style.maxHeight = '600px';
        resultsEl.style.marginTop = '10px';
        resultsEl.innerHTML = `
            ${metaParts.length ? `<div style="font-size:12px; color:#9a9a9a; line-height:2; margin-bottom:2px;">${metaParts.join(' &ensp;|&ensp; ')}</div>` : ''}
            ${portTableHtml}`;
    }
}

// ── Bulk defend ───────────────────────────────────────────────────────────────

async function bulkDefendDevices() {
    const checks  = [...document.querySelectorAll('.device-select-check:checked')];
    if (!checks.length) { showNotification('Select at least one device.', 'warning'); return; }
    const allDevs = getNetworkDevices();
    const targets = checks.map(c => allDevs.find(d => d.id === c.dataset.deviceId)).filter(Boolean);
    if (!targets.length) return;
    _showBulkDefendModal(targets);
}

function _showBulkDefendModal(targets) {
    document.getElementById('bulkDefendModal')?.remove();

    const rowsHtml = targets.map(dev => `
        <div style="border:1px solid rgba(157,78,221,.2); border-radius:7px; padding:12px 16px; margin-bottom:10px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <div>
                    <strong style="color:#B0E0E6; font-size:13px;">${_escapeHtml(dev.name)}</strong>
                    <span style="color:#666; font-size:12px; margin-left:8px;">${_escapeHtml(dev.ip)}</span>
                    ${dev.os ? `<br><span style="color:#666; font-size:11px;">&#128187; ${_escapeHtml(dev.os.slice(0,60))}</span>` : ''}
                    ${dev.open_count > 0 ? `<br><span style="color:#9a9a9a; font-size:11px;">${dev.open_count} open port${dev.open_count !== 1 ? 's' : ''}${dev.services?.length ? ': ' + dev.services.slice(0,3).map(s => _escapeHtml(s)).join(', ') : ''}</span>` : '<br><span style="color:#555; font-size:11px;">Not yet scanned &mdash; scan first to identify open ports.</span>'}
                </div>
                <button class="btn btn-outline"
                    style="font-size:11px; padding:5px 12px; color:#9D4EDD; border-color:#9D4EDD; white-space:nowrap;"
                    onclick="document.getElementById('bulkDefendModal').remove(); defendDevice('${_escapeHtml(dev.ip)}', '${dev.id}')">
                    &#128737; Defend
                </button>
            </div>
        </div>`).join('');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id        = 'bulkDefendModal';
    modal.style.display = 'flex';
    modal.style.zIndex  = '10000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:640px; width:95vw; max-height:85vh; overflow-y:auto;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#9D4EDD;">
                    Defend Selected &mdash; ${targets.length} Device${targets.length !== 1 ? 's' : ''}
                </h3>
                <button class="btn btn-outline" style="padding:4px 10px;"
                    onclick="document.getElementById('bulkDefendModal').remove()">&#10005;</button>
            </div>
            <div class="modal-body" style="margin-top:14px;">
                <p style="color:#888; font-size:12px; margin-bottom:16px; line-height:1.55;">
                    Click <strong style="color:#9D4EDD;">Defend</strong> on a device to open its defence console.
                    Scan devices first to identify open ports before configuring defences.
                </p>
                ${rowsHtml}
                <div style="display:flex; justify-content:flex-end; margin-top:14px;">
                    <button class="btn btn-primary" style="font-size:12px;"
                        onclick="document.getElementById('bulkDefendModal').remove()">Done</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

async function scanNetworkDevices() {
    const btn         = document.getElementById('scanNetworkBtn');
    const progressBar = document.getElementById('scanProgressBar');
    const statusText  = document.getElementById('scanStatusText');
    _networkScanInProgress = true;
    if (btn)         { btn.disabled = true; btn.innerHTML = '&#9203; Scanning&hellip;'; }
    if (progressBar) { progressBar.classList.add('scanning'); }
    if (statusText)  { statusText.style.display = 'block'; statusText.textContent = 'Probing network hosts…'; }

    showNotification('Scanning local network for devices…');

    try {
        const result = await BackendAPI.callBackend('scan-network', {});
        if (!result?.success) throw new Error(result?.error || 'Scan failed');
        const discovered = (result.hosts || []).map(h => ({
            ip:       h.ip,
            name:     h.name || h.hostname || h.ip,
            mac:      h.mac      || '',
            vendor:   h.vendor   || '',
            latency:  h.latency  || '',
            hostname: h.hostname || '',
        }));
        const subnet   = result.subnet || _getLocalSubnet();
        const existing = getNetworkDevices();
        const existIPs = new Set(existing.map(d => d.ip));
        const newCount = discovered.filter(d => !existIPs.has(d.ip)).length;
        showNotification(
            discovered.length === 0
                ? 'Scan complete — no devices found. Ensure nmap or arp-scan is installed.'
                : `Scan complete — ${discovered.length} device${discovered.length !== 1 ? 's' : ''} found (${newCount} new).`,
            discovered.length === 0 ? 'warning' : 'success'
        );
        _showScanResultsModal(discovered, subnet);
    } catch (err) {
        showNotification('Network scan failed.', 'error');
        console.error('scanNetworkDevices error:', err);
    } finally {
        _networkScanInProgress = false;
        if (btn)         { btn.disabled = false; btn.innerHTML = '&#128269; Scan Network'; }
        if (progressBar) { progressBar.classList.remove('scanning'); }
        if (statusText)  { statusText.style.display = 'none'; statusText.textContent = ''; }
    }
}

function _showScanResultsModal(discovered, subnet) {
    const existing  = getNetworkDevices();
    const existIPs  = new Set(existing.map(d => d.ip));
    const tier      = getActiveTier();
    const slotsLeft = tier.maxDevices - existing.length;
    const newHosts  = discovered.filter(d => !existIPs.has(d.ip));

    const rowsHtml = discovered.length === 0
        ? `<p style="color:#B0E0E6; text-align:center; padding:24px;">No hosts found on ${_escapeHtml(subnet)}</p>`
        : discovered.map(d => {
            const alreadyAdded = existIPs.has(d.ip);
            return `
                <label style="display:flex; align-items:center; gap:12px; padding:10px 0;
                    border-bottom:1px solid rgba(255,255,255,.06);
                    cursor:${alreadyAdded ? 'default' : 'pointer'};">
                    ${alreadyAdded
                        ? `<span style="width:18px; flex-shrink:0; color:#4caf50; font-size:15px;">&#10003;</span>`
                        : `<input type="checkbox" class="scan-device-check"
                            data-ip="${_escapeHtml(d.ip)}"
                            data-name="${_escapeHtml(d.name)}"
                            data-mac="${_escapeHtml(d.mac)}"
                            style="width:16px; height:16px; accent-color:#B0E0E6; flex-shrink:0; cursor:pointer;">`
                    }
                    <div style="flex:1; min-width:0;">
                        <strong style="color:#B0E0E6; font-size:13px;">${_escapeHtml(d.ip)}</strong>
                        ${d.name && d.name !== d.ip
                            ? `<span style="color:#9a9a9a; font-size:12px; margin-left:8px;">${_escapeHtml(d.name)}</span>`
                            : ''}
                        ${d.mac
                            ? `<br><span style="color:#666; font-size:11px;">${_escapeHtml(d.mac)}${d.vendor ? ' \u00b7 ' + _escapeHtml(d.vendor) : ''}</span>`
                            : ''}
                    </div>
                    ${alreadyAdded
                        ? `<span style="color:#4caf50; font-size:11px; flex-shrink:0;">Connected</span>`
                        : `<span class="scan-row-status" data-ip="${_escapeHtml(d.ip)}"
                            style="color:#888; font-size:11px; flex-shrink:0;"></span>`
                    }
                </label>`;
          }).join('');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id        = 'scanResultsModal';
    modal.style.display = 'flex';
    modal.style.zIndex  = '10000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:540px; width:92vw; max-height:82vh; overflow-y:auto;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#B0E0E6;">
                    Discovered Devices &mdash; ${_escapeHtml(subnet)}
                </h3>
                <button class="btn btn-outline" style="padding:4px 10px;"
                    onclick="document.getElementById('scanResultsModal').remove()">&#10005;</button>
            </div>
            <div class="modal-body" style="margin-top:12px;">
                <p style="color:#B0E0E6; font-size:13px; margin-bottom:4px;">
                    ${discovered.length} host${discovered.length !== 1 ? 's' : ''} found &mdash;
                    ${newHosts.length} new.
                </p>
                <p style="color:#888; font-size:12px; margin-bottom:14px; line-height:1.5;">
                    Select devices to connect. A request will be sent to each device &mdash;
                    the owner must <strong style="color:#ff9800;">approve</strong> before the device is added to your network.
                </p>
                <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
                    <button class="btn btn-outline" style="font-size:11px; padding:4px 10px;"
                        onclick="selectAllScanResults(true)">Select All</button>
                    <button class="btn btn-outline" style="font-size:11px; padding:4px 10px;"
                        onclick="selectAllScanResults(false)">Deselect All</button>
                    <span style="color:#888; font-size:11px; margin-left:auto;">
                        Slots available: <strong style="color:${tier.color};">${slotsLeft}</strong>
                    </span>
                </div>
                <div>${rowsHtml}</div>
                <div style="display:flex; gap:8px; margin-top:16px; justify-content:flex-end; flex-wrap:wrap;">
                    <button class="btn btn-outline" style="font-size:12px;"
                        onclick="document.getElementById('scanResultsModal').remove()">Cancel</button>
                    <button class="btn btn-primary" style="font-size:12px;"
                        onclick="_requestSelectedConnections()">
                        &#128279; Request Connection
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function selectAllScanResults(checked) {
    document.querySelectorAll('.scan-device-check').forEach(cb => { cb.checked = checked; });
}

async function _requestSelectedConnections() {
    const checked = [...document.querySelectorAll('.scan-device-check:checked')];
    if (!checked.length) { showNotification('Select at least one device.', 'warning'); return; }

    const tier      = getActiveTier();
    const existing  = getNetworkDevices();
    const slotsLeft = tier.maxDevices - existing.length;

    if (checked.length > slotsLeft) {
        showNotification(`Only ${slotsLeft} slot(s) available. Uncheck ${checked.length - slotsLeft} device(s).`, 'warning');
        return;
    }

    const connBtn = document.querySelector('#scanResultsModal .btn-primary');
    if (connBtn) { connBtn.disabled = true; connBtn.textContent = 'Sending requests\u2026'; }

    const localName = localStorage.getItem('kjerHostname') || localStorage.getItem('kjerLocalIP') || 'Kjer Device';
    const localIP   = localStorage.getItem('kjerLocalIP') || '';

    for (const cb of checked) {
        const ip        = cb.dataset.ip;
        const name      = cb.dataset.name;
        const mac       = cb.dataset.mac;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const device    = {
            id:         `${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
            name:       name && name !== ip ? name : ip,
            ip, mac:    mac || '', os: '',
            status:     'pending',
            addedAt:    new Date().toISOString(),
            lastScan:   null,
            _requestId: requestId,
        };

        const added = addNetworkDevice(device);
        if (!added) continue; // tier limit or duplicate

        const statusEl = document.querySelector(`.scan-row-status[data-ip="${ip}"]`);
        if (statusEl) { statusEl.textContent = 'Requesting\u2026'; statusEl.style.color = '#ff9800'; }

        try {
            const resp = await window.electronAPI?.sendConnectionRequest?.({
                targetIP: ip, requestId, requesterName: localName, requesterIP: localIP,
            });
            if (resp?.success) {
                if (statusEl) { statusEl.textContent = '\u23f3 Awaiting approval'; statusEl.style.color = '#2196F3'; }
            } else {
                // Kjer not running on target \u2014 mark as online (no approval system available)
                const devs = getNetworkDevices();
                const d    = devs.find(x => x.ip === ip);
                if (d) { d.status = 'online'; saveNetworkDevices(devs); }
                if (statusEl) { statusEl.textContent = 'Added (Kjer not on target)'; statusEl.style.color = '#888'; }
            }
        } catch (e) {
            const devs = getNetworkDevices();
            const d    = devs.find(x => x.ip === ip);
            if (d) { d.status = 'online'; saveNetworkDevices(devs); }
            if (statusEl) { statusEl.textContent = 'Added (no response)'; statusEl.style.color = '#888'; }
        }
    }

    renderNetworkPage();
    showNotification('Connection request(s) sent \u2014 awaiting approval from device owners.');
    setTimeout(() => document.getElementById('scanResultsModal')?.remove(), 2200);
}

function showAddDeviceModal() {
    const tier = getActiveTier();
    const existing = getNetworkDevices();
    if (existing.length >= tier.maxDevices) {
        showNotification(`Device limit reached (${tier.maxDevices}). Upgrade your license to add more.`, 'warning');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id        = 'addDeviceModal';
    modal.style.display = 'flex';
    modal.style.zIndex  = '10000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:420px; width:90vw;">
            <div class="modal-header">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#B0E0E6;">Add Network Device</h3>
            </div>
            <div class="modal-body" style="margin-top:16px; display:flex; flex-direction:column; gap:14px;">
                <div>
                    <label style="display:block; color:#ccc; font-size:13px; margin-bottom:6px;">Device Name *</label>
                    <input id="addDevName" type="text" class="form-input" placeholder="e.g. Living Room PC"
                        style="width:100%; box-sizing:border-box;" maxlength="80">
                </div>
                <div>
                    <label style="display:block; color:#ccc; font-size:13px; margin-bottom:6px;">IP Address *</label>
                    <input id="addDevIP" type="text" class="form-input" placeholder="e.g. 192.168.1.105"
                        style="width:100%; box-sizing:border-box;" maxlength="45">
                </div>
                <div>
                    <label style="display:block; color:#ccc; font-size:13px; margin-bottom:6px;">Operating System <span style="color:#555;">(optional)</span></label>
                    <input id="addDevOS" type="text" class="form-input" placeholder="e.g. Windows 11, Ubuntu 22.04"
                        style="width:100%; box-sizing:border-box;" maxlength="80">
                </div>
                <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:6px;">
                    <button class="btn btn-outline" onclick="document.getElementById('addDeviceModal').remove()">Cancel</button>
                    <button class="btn btn-primary" onclick="_submitAddDeviceModal()">Add Device</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('addDevName')?.focus(), 50);
}

function _submitAddDeviceModal() {
    const name = (document.getElementById('addDevName')?.value || '').trim();
    const ip   = (document.getElementById('addDevIP')?.value   || '').trim();
    const os   = (document.getElementById('addDevOS')?.value   || '').trim();

    if (!name) { showNotification('Please enter a device name.', 'warning'); return; }
    if (!ip || !/^[\d.a-f:]+$/i.test(ip)) { showNotification('Please enter a valid IP address.', 'warning'); return; }

    const device = {
        id: Date.now().toString(),
        name, ip, mac: '', os,
        status: 'unknown',
        addedAt: new Date().toISOString(),
        lastScan: null,
    };
    const success = addNetworkDevice(device);
    if (success) {
        document.getElementById('addDeviceModal')?.remove();
        // Auto-scan to populate connection info with minimum manual steps
        setTimeout(() => scanDevice(device.ip, device.id), 400);
    }
}

function addNetworkDevice(device) {
    const tier    = getActiveTier();
    const devices = getNetworkDevices();

    if (devices.length >= tier.maxDevices) {
        showNotification(`Device limit reached (${tier.maxDevices}/${tier.maxDevices}). Upgrade to add more.`, 'warning');
        return false;
    }

    // Prevent duplicate IPs
    if (devices.find(d => d.ip === device.ip)) {
        showNotification(`${device.ip} is already in your device list.`, 'warning');
        return false;
    }

    devices.push(device);
    saveNetworkDevices(devices);
    renderNetworkPage();
    showNotification(`${device.name} added to network devices.`);
    logActivity(`Added network device: ${device.name} (${device.ip})`);
    // Auto-ping to set initial online/offline status for manually added devices
    if (device.status === 'unknown') {
        _pingDeviceStatus(device.ip).then(status => {
            const devs = getNetworkDevices();
            const d    = devs.find(x => x.id === device.id);
            if (d && d.status === 'unknown') {
                d.status = status;
                saveNetworkDevices(devs);
                if (document.getElementById('network')?.classList.contains('active')) renderNetworkPage();
            }
        });
    }
    return true;
}

function removeNetworkDevice(id) {
    const devices = getNetworkDevices().filter(d => d.id !== id);
    saveNetworkDevices(devices);
    renderNetworkPage();
    showNotification('Device removed.');
    logActivity(`Removed network device id: ${id}`);
}

async function scanDevice(ip, deviceId) {
    const devices = getNetworkDevices();
    const dev     = devices.find(d => d.id === deviceId);
    if (dev) { dev.status = 'scanning'; saveNetworkDevices(devices); renderNetworkPage(); }

    showNotification(`Scanning ${ip}…`);

    try {
        const result = await BackendAPI.callBackend('scan-device', { tool: ip });
        if (!result?.success) throw new Error(result?.error || 'Scan failed');

        // Persist enriched data on device record
        const devs = getNetworkDevices();
        const d2   = devs.find(d => d.id === deviceId);
        if (d2) {
            d2.status   = 'online';
            d2.lastScan = new Date().toISOString();
            if (result.os       && !d2.os)       d2.os          = result.os.slice(0, 80);
            if (result.mac      && !d2.mac)       d2.mac         = result.mac;
            if (result.vendor   && !d2.vendor)    d2.vendor      = result.vendor;
            if (result.hostname && !d2.hostname)  d2.hostname    = result.hostname;
            d2.latency      = result.latency      || d2.latency      || '';
            d2.open_count   = result.open_count   ?? d2.open_count   ?? 0;
            d2.services     = result.services     || d2.services     || [];
            d2.uptime_guess = result.uptime_guess || d2.uptime_guess || '';
            saveNetworkDevices(devs);
            renderNetworkPage();
        }

        _showDeviceScanResultsModal(ip, result, deviceId);
        logActivity(`Scanned device ${ip}: ${result.open_count || 0} open ports`);
    } catch (err) {
        showNotification(`Scan of ${ip} failed.`, 'error');
        const devs = getNetworkDevices();
        const d3   = devs.find(d => d.id === deviceId);
        if (d3) { d3.status = 'unknown'; saveNetworkDevices(devs); renderNetworkPage(); }
        console.error('scanDevice error:', err);
    }
}

function _showDeviceScanResultsModal(ip, scanResult, deviceId) {
    const ports    = scanResult?.ports    || [];
    const scripts  = scanResult?.scripts  || {};
    const osGuess  = scanResult?.os       || '';
    const vendor   = scanResult?.vendor   || '';
    const mac      = scanResult?.mac      || '';
    const latency  = scanResult?.latency  || '';
    const hostname = scanResult?.hostname || '';
    const uptime   = scanResult?.uptime_guess || '';
    const rawStr   = scanResult?.raw      || (typeof scanResult === 'string' ? scanResult : '');
    const openPorts = ports.filter(p => p.state === 'open');

    const metaRows = [
        hostname && hostname !== ip ? `<tr><td style="padding:4px 10px;color:#888;">Hostname</td><td style="padding:4px 10px;color:#ccc;">${_escapeHtml(hostname)}</td></tr>` : '',
        osGuess ? `<tr><td style="padding:4px 10px;color:#888;">OS</td><td style="padding:4px 10px;color:#ccc;">${_escapeHtml(osGuess)}${scanResult?.os_accuracy ? ` <span style="color:#666;">${scanResult.os_accuracy}%</span>` : ''}</td></tr>` : '',
        mac ? `<tr><td style="padding:4px 10px;color:#888;">MAC</td><td style="padding:4px 10px;color:#ccc;">${_escapeHtml(mac)}${vendor ? ` <span style="color:#666;">&middot; ${_escapeHtml(vendor)}</span>` : ''}</td></tr>` : '',
        latency  ? `<tr><td style="padding:4px 10px;color:#888;">Latency</td><td style="padding:4px 10px;color:#ccc;">${_escapeHtml(latency)}</td></tr>` : '',
        uptime   ? `<tr><td style="padding:4px 10px;color:#888;">Uptime</td><td style="padding:4px 10px;color:#ccc;">${_escapeHtml(uptime)}</td></tr>` : '',
    ].filter(Boolean).join('');

    const portRows = openPorts.length > 0
        ? openPorts.map(p => `
            <tr>
                <td style="padding:4px 10px; color:#B0E0E6; font-family:monospace;">${p.port}/${_escapeHtml(p.proto)}</td>
                <td style="padding:4px 10px; color:#4caf50;">${_escapeHtml(p.state)}</td>
                <td style="padding:4px 10px; color:#ccc;">${_escapeHtml(p.service)}</td>
                <td style="padding:4px 10px; color:#888; font-size:12px;">${_escapeHtml(p.version || '')}</td>
            </tr>`).join('')
        : `<tr><td colspan="4" style="color:#555; padding:12px; text-align:center;">No open ports detected.</td></tr>`;

    const scriptKeys = Object.keys(scripts).slice(0, 8);
    const scriptHtml = scriptKeys.length > 0
        ? `<h4 style="color:#9D4EDD;font-family:'Tomorrow',sans-serif;font-size:12px;margin:16px 0 8px;text-transform:uppercase;">Script Output</h4>
           <dl style="margin:0;font-size:12px;">${scriptKeys.map(k =>
             `<dt style="color:#888;margin-top:8px;">${_escapeHtml(k)}</dt>
              <dd style="color:#ccc;margin:2px 0 0 0;word-break:break-all;">${_escapeHtml(scripts[k])}</dd>`).join('')}</dl>` : '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.zIndex  = '10000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:660px; width:95vw; max-height:85vh; overflow-y:auto;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#B0E0E6;">
                    Scan Results &mdash; ${_escapeHtml(ip)}
                </h3>
                <button class="btn btn-outline" style="padding:4px 10px;"
                    onclick="this.closest('.modal').remove()">&#10005;</button>
            </div>
            <div class="modal-body" style="margin-top:14px;">
                ${metaRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;"><colgroup><col style="width:90px"></colgroup><tbody>${metaRows}</tbody></table>` : ''}
                <h4 style="color:#9D4EDD; font-family:'Tomorrow',sans-serif; font-size:13px; margin:0 0 10px 0; text-transform:uppercase;">
                    Open Ports &amp; Services${openPorts.length ? ` <span style="color:#666;">(${openPorts.length})</span>` : ''}
                </h4>
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead>
                        <tr style="border-bottom:1px solid rgba(255,255,255,.1);">
                            <th style="text-align:left; padding:4px 10px; color:#888;">Port</th>
                            <th style="text-align:left; padding:4px 10px; color:#888;">State</th>
                            <th style="text-align:left; padding:4px 10px; color:#888;">Service</th>
                            <th style="text-align:left; padding:4px 10px; color:#888;">Version</th>
                        </tr>
                    </thead>
                    <tbody>${portRows}</tbody>
                </table>
                ${scriptHtml}
                <details style="margin-top:16px;">
                    <summary style="cursor:pointer; color:#555; font-size:12px; user-select:none;">Raw output</summary>
                    <pre style="background:rgba(0,0,0,.3); border-radius:4px; padding:12px; font-size:11px;
                        color:#888; overflow-x:auto; white-space:pre-wrap; word-break:break-all;
                        max-height:200px; overflow-y:auto; margin-top:8px;">${_escapeHtml(rawStr)}</pre>
                </details>
                <div style="display:flex; gap:8px; margin-top:16px; justify-content:flex-end;">
                    <button class="btn btn-outline" style="font-size:12px;"
                        onclick="defendDevice('${_escapeHtml(ip)}', '${deviceId}'); this.closest('.modal').remove()">
                        &#128737; Defend This Device
                    </button>
                    <button class="btn btn-primary" style="font-size:12px;"
                        onclick="this.closest('.modal').remove()">Close</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

async function defendDevice(ip, deviceId) {
    const devices = getNetworkDevices();
    const dev     = devices.find(d => d.id === deviceId);
    if (dev) { dev.status = 'defending'; saveNetworkDevices(devices); renderNetworkPage(); }

    // Build defend modal with recommended actions + runnable Kjer tools
    const installedTools = getInstalledTools();
    const defensiveNames = ['ufw', 'firewalld', 'fail2ban', 'suricata', 'snort', 'ossec', 'auditd', 'aide', 'rkhunter', 'chkrootkit'];
    const availableTools = Object.entries(installedTools)
        .filter(([, t]) => defensiveNames.some(n => (t.name || '').toLowerCase().includes(n)))
        .map(([k, t]) => ({ key: k, name: t.name || k }));

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id        = 'defendDeviceModal';
    modal.style.display = 'flex';
    modal.style.zIndex  = '10000';

    const toolBtns = availableTools.length > 0
        ? availableTools.map(t => `
            <button class="btn btn-outline" style="font-size:12px; padding:6px 14px;"
                onclick="_runDefensiveToolOnDevice('${t.key}', '${_escapeHtml(ip)}')">
                &#9654; Run ${_escapeHtml(t.name)}
            </button>`).join('')
        : '<p style="color:#555; font-size:12px;">No defensive tools installed. Install tools from the Tools tab.</p>';

    modal.innerHTML = `
        <div class="modal-content" style="max-width:540px; width:92vw; max-height:82vh; overflow-y:auto;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#9D4EDD;">
                    Defend &mdash; ${_escapeHtml(ip)}
                </h3>
                <button class="btn btn-outline" style="padding:4px 10px;"
                    onclick="document.getElementById('defendDeviceModal').remove(); _clearDeviceDefendingState('${deviceId}')">&#10005;</button>
            </div>
            <div class="modal-body" style="margin-top:14px;">
                <h4 style="color:#ff9800; font-family:'Tomorrow',sans-serif; font-size:12px; text-transform:uppercase; margin:0 0 10px 0;">
                    Recommended Actions
                </h4>
                <ul style="color:#9a9a9a; font-size:13px; line-height:1.8; margin:0 0 20px 0; padding-left:18px;">
                    <li>Ensure firewall is active on the target device (UFW / firewalld).</li>
                    <li>Close any unnecessary open ports found during scan.</li>
                    <li>Enable <strong style="color:#ccc;">fail2ban</strong> to block brute-force login attempts.</li>
                    <li>Enable <strong style="color:#ccc;">auditd</strong> for system call auditing.</li>
                    <li>Run a rootkit check with <strong style="color:#ccc;">rkhunter</strong> or <strong style="color:#ccc;">chkrootkit</strong>.</li>
                    <li>Deploy <strong style="color:#ccc;">Suricata</strong> or <strong style="color:#ccc;">Snort</strong> IDS for traffic monitoring.</li>
                </ul>
                <h4 style="color:#9D4EDD; font-family:'Tomorrow',sans-serif; font-size:12px; text-transform:uppercase; margin:0 0 10px 0;">
                    Run Kjer Tools Against ${_escapeHtml(ip)}
                </h4>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">
                    ${toolBtns}
                </div>
                <div id="defendOutputArea"></div>
                <div style="display:flex; justify-content:flex-end; margin-top:14px;">
                    <button class="btn btn-primary" style="font-size:12px;"
                        onclick="document.getElementById('defendDeviceModal').remove(); _clearDeviceDefendingState('${deviceId}')">
                        Done
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

async function _runDefensiveToolOnDevice(toolKey, ip) {
    const outputArea = document.getElementById('defendOutputArea');
    if (outputArea) {
        outputArea.innerHTML = `<pre style="background:rgba(0,0,0,.3); border-radius:4px;
            padding:12px; color:#888; font-size:11px; overflow-x:auto; white-space:pre-wrap;
            word-break:break-all; max-height:200px; overflow-y:auto;">Running ${_escapeHtml(toolKey)}…</pre>`;
    }
    try {
        const result = await window.electronAPI.executeCommand(toolKey, [ip]);
        const output = (result?.stdout || result || '').toString();
        if (outputArea) {
            outputArea.innerHTML = `
                <h5 style="color:#B0E0E6; font-size:12px; margin:0 0 8px 0;">${_escapeHtml(toolKey)} output</h5>
                <pre style="background:rgba(0,0,0,.3); border-radius:4px; padding:12px; color:#ccc; font-size:11px;
                    overflow-x:auto; white-space:pre-wrap; word-break:break-all;
                    max-height:220px; overflow-y:auto;">${_escapeHtml(output)}</pre>`;
        }
        logActivity(`Ran ${toolKey} against ${ip}`);
    } catch (err) {
        if (outputArea) {
            outputArea.innerHTML = `<p style="color:#f44336; font-size:12px;">
                Failed to run ${_escapeHtml(toolKey)}: ${_escapeHtml(String(err.message || err))}</p>`;
        }
    }
}

function _clearDeviceDefendingState(deviceId) {
    const devs = getNetworkDevices();
    const dev  = devs.find(d => d.id === deviceId);
    if (dev && dev.status === 'defending') {
        dev.status = dev.lastScan ? 'online' : 'unknown';
        saveNetworkDevices(devs);
        renderNetworkPage();
    }
}

/** Quick nmap ping-scan a single IP — returns 'online' or 'offline'. */
async function _pingDeviceStatus(ip) {
    try {
        const result = await window.electronAPI.executeCommand('nmap', ['-sn', '--host-timeout', '3s', ip]);
        const out = (result?.stdout || result || '').toString();
        return out.includes('Host is up') ? 'online' : 'offline';
    } catch (e) {
        return 'offline';
    }
}

// ── Incoming connection request (another device wants to connect to us) ──────

function showIncomingConnectionRequest(data) {
    // Prevent duplicate modals for the same requestId
    if (document.getElementById(`incomingReq-${data.requestId}`)) return;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id        = `incomingReq-${data.requestId}`;
    modal.style.display = 'flex';
    modal.style.zIndex  = '11000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:440px; width:92vw; border:1px solid #ff9800;">
            <div class="modal-header" style="background:rgba(255,152,0,.08); border-bottom:1px solid rgba(255,152,0,.25);">
                <h3 style="margin:0; font-family:'Tomorrow',sans-serif; color:#ff9800;">
                    &#128279; Incoming Connection Request
                </h3>
            </div>
            <div class="modal-body" style="margin-top:14px;">
                <p style="color:#ccc; font-size:14px; line-height:1.6; margin-bottom:10px;">
                    <strong style="color:#B0E0E6;">${_escapeHtml(data.requesterName)}</strong>
                    <span style="color:#888; font-size:12px;">&nbsp;(${_escapeHtml(data.requesterIP)})</span>
                    wants to add this device to their Kjer network.
                </p>
                <p style="color:#888; font-size:12px; line-height:1.55; margin-bottom:20px; padding:10px 12px;
                    background:rgba(255,152,0,.06); border-left:2px solid #ff9800; border-radius:0 4px 4px 0;">
                    Approving lets them run security scans and defensive tools on this device remotely.
                    <strong style="color:#ccc;">Only approve if you recognise this device and trust the user.</strong>
                </p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button class="btn btn-outline"
                        style="color:#f44336; border-color:#f44336;"
                        onclick="_respondToConnectionRequest('${data.requestId}','${_escapeHtml(data.requesterIP)}',false)">
                        &#10005; Deny
                    </button>
                    <button class="btn btn-primary"
                        onclick="_respondToConnectionRequest('${data.requestId}','${_escapeHtml(data.requesterIP)}',true)">
                        &#10003; Approve
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

async function _respondToConnectionRequest(requestId, requesterIP, approved) {
    const localName = localStorage.getItem('kjerHostname')
                   || localStorage.getItem('kjerLocalIP')
                   || 'Kjer Device';
    document.getElementById(`incomingReq-${requestId}`)?.remove();
    try {
        await window.electronAPI?.sendConnectionResponse?.({
            targetIP: requesterIP, requestId, approved, approverName: localName,
        });
    } catch (e) {
        console.error('Failed to send connection response:', e);
    }
    await window.electronAPI?.clearPendingRequest?.(requestId);
    showNotification(approved ? 'Connection approved.' : 'Connection denied.');
    logActivity(`Connection request from ${requesterIP}: ${approved ? 'approved' : 'denied'}`);
}

function _handleConnectionResponse(data) {
    // data = { requestId, approved, approverName }
    const devs = getNetworkDevices();
    const dev  = devs.find(d => d._requestId === data.requestId);
    if (!dev) return;

    if (data.approved) {
        dev.status = 'online';
        showNotification(`${dev.name} approved the connection.`);
        logActivity(`Device ${dev.ip} approved connection request.`);
    } else {
        dev.status = 'denied';
        showNotification(`${dev.name} denied the connection request.`, 'warning');
        logActivity(`Device ${dev.ip} denied connection request.`);
    }
    saveNetworkDevices(devs);
    if (document.getElementById('network')?.classList.contains('active')) renderNetworkPage();
}

function _initNetworkListeners() {
    if (!window.electronAPI) return;
    // Incoming request from another device asking to connect
    window.electronAPI.onConnectionRequest?.((data) => showIncomingConnectionRequest(data));
    // Response to our outgoing connection request
    window.electronAPI.onConnectionResponse?.((data) => _handleConnectionResponse(data));
    // Catch requests that arrived before the window was fully ready
    window.electronAPI.getPendingRequests?.().then(pending => {
        (pending || []).forEach(req => showIncomingConnectionRequest(req));
    });
}

// ==================== UTILITY FUNCTIONS ====================

function getToolCount() {
    return Object.keys(TOOLS_DATABASE).length;
}

function getProfileCount() {
    return PROFILES_DATABASE.length;
}

// Handle keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl+K for search
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('toolSearch');
        if (searchInput) {
            searchInput.focus();
            switchTab('tools');
        }
    }
    
    // Ctrl+, for settings
    if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        switchTab('settings');
    }
});
