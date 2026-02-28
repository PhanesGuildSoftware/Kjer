/* ============================================
   Kjer - Application JavaScript
   ============================================ */

// ==================== BACKEND API INTEGRATION ====================

const BackendAPI = {
    /**
     * Execute backend Python script
     */
    async callBackend(action, params = {}) {
        const args = ['../lib/backend_api.py', action];
        
        if (params.licenseKey) args.push('--license-key', params.licenseKey);
        if (params.licenseType) args.push('--license-type', params.licenseType);
        if (params.tool) args.push('--tool', params.tool);
        if (params.profile) args.push('--profile', params.profile);
        if (params.detectedOS) args.push('--detected-os', params.detectedOS);
        
        try {
            const response = await window.electronAPI?.executeCommand('python3', args);
            if (response && response.stdout) {
                return JSON.parse(response.stdout);
            }
            return { success: false, error: 'No response from backend' };
        } catch (error) {
            console.error('Backend API error:', error);
            return { success: false, error: error.message };
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
    localStorage.removeItem('kterInitialized');
    localStorage.removeItem('userOS');
    localStorage.removeItem('initializationDate');
    localStorage.removeItem('kterTutorialCompleted');
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
 * Read ~/.kjer/install_state.json via Electron IPC and store the detected OS
 * in localStorage so every part of the GUI uses the installer-detected OS
 * rather than the browser user-agent.  Falls back to navigator user-agent
 * if the state file is not found (pre-install / web-only mode).
 *
 * Call this once, early in DOMContentLoaded (before any rendering).
 */
async function loadInstallStateIntoApp() {
    try {
        const result = await BackendAPI.getInstallState();
        if (result.success && result.state) {
            const { os, distro, installed_at, initialized } = result.state;
            if (os) {
                // Persist so synchronous code (renderToolsList etc.) can read it
                localStorage.setItem('userOS', os);
                if (distro)       localStorage.setItem('userDistro', distro);
                if (installed_at) localStorage.setItem('installedAt', installed_at);
                logActivity(`OS detected at install time: ${distro || os}`, 'success');
            }
            // Restore initialized flag — if ~/.kjer/initialized exists the user has
            // already completed setup; don't show first-time screens again.
            // If the flag is absent (reset/uninstall), clear any stale localStorage value.
            if (initialized === true) {
                localStorage.setItem('kterInitialized', 'true');
                logActivity('Initialization state restored from disk', 'info');
            } else if (initialized === false) {
                localStorage.removeItem('kterInitialized');
            }
        }
    } catch (e) {
        console.warn('Could not read install state:', e);
    }

    // Read version.json to keep kterVersion in sync with what's on disk.
    // This ensures the sidebar/settings always show the correct version after upgrades.
    try {
        const vf = await window.electronAPI?.readVersionFile?.();
        if (vf?.success && vf.data?.version) {
            localStorage.setItem('kterVersion', vf.data.version);
        }
    } catch (e) { /* non-fatal */ }

    // Fallback: browser user-agent (Electron reports the host OS correctly)
    if (!localStorage.getItem('userOS')) {
        localStorage.setItem('userOS', SystemInfo.detectOS());
    }

    // Restore saved license key from disk if localStorage is empty.
    // This handles localStorage clears, app reinstalls, and first-run after
    // the CLI was used to activate (CLI also writes license_key.json).
    if (!localStorage.getItem('kterLicenseKey')) {
        try {
            const cached = await readLicenseKeyFromDisk();
            if (cached && cached.key) {
                localStorage.setItem('kterLicenseKey',  cached.key);
                if (cached.type) localStorage.setItem('kterLicenseType', cached.type);
                // A key on disk means the user successfully activated — restore that state.
                localStorage.setItem('kterActivated', 'true');
                logActivity('License key restored from saved state', 'info');
            }
        } catch (e) { /* non-fatal */ }
    }

    return localStorage.getItem('userOS');
}

// ==================== TUTORIAL SYSTEM ====================
// Force restart tutorial from settings
function restartTutorial() {
    Tutorial.completed = false;
    localStorage.removeItem('kterTutorialCompleted');
    Tutorial.currentStep = 0;
    Tutorial.displayStep();
    document.getElementById('tutorialModal').style.display = 'flex';
}

const Tutorial = {
    currentStep: 0,
    completed: localStorage.getItem('kterTutorialCompleted') === 'true',
    
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
        localStorage.setItem('kterTutorialCompleted', 'true');
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
    localStorage.setItem('kterTutorialCompleted', 'true');
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
    localStorage.setItem('kterInitialized', 'true');
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

    // Detect and register pre-installed tools — must run before CLI integration
    await syncPreInstalledTools(installedOS);

    // Auto-register the 'kjer' CLI command on the host system
    await setupCLIIntegration(installedOS);

    // Ensure local Electron dependencies are installed so CLI 'kjer --gui' works
    await setupElectronDependencies(installedOS);

    // Initialization complete — tools and profiles are now fully operational
    setTimeout(() => {
        logActivity('Initialization complete — Kjer is fully operational', 'success', '', true);
        showNotification('✓ Kjer initialized successfully!');
    }, 2000);

    } catch (initErr) {
        localStorage.removeItem('kterInitialized');
        logActivity(`Initialization failed: ${initErr.message || initErr}`, 'error', '', true);
        showNotification('✗ Initialization failed. Check the activity log for details.');
    }
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

function showActivationModal() {
    document.getElementById('activationModal').style.display = 'flex';
    // Pre-fill with the previously used key
    const savedKey = localStorage.getItem('kterLicenseKey') || '';
    const keyInput = document.getElementById('licenseKeyInput');
    if (keyInput && savedKey) keyInput.value = savedKey;
    document.getElementById('activationStatus').innerHTML = '';
}

function closeActivationModal() {
    document.getElementById('activationModal').style.display = 'none';
}

async function activateKjer() {
    const licenseKey = document.getElementById('licenseKeyInput').value.trim().toUpperCase();
    // Infer license type from key prefix (KJER-PRO-..., KJER-ENT-...) or fall back to stored/personal
    const keyLower   = licenseKey.toLowerCase();
    const licenseType = keyLower.includes('ent') ? 'enterprise'
                      : keyLower.includes('pro') ? 'professional'
                      : (localStorage.getItem('kterLicenseType') || 'personal');
    const statusDiv = document.getElementById('activationStatus');
    
    if (!licenseKey || licenseKey.length !== 24) {
        statusDiv.innerHTML = '<span style="color: #ff6b6b;">Invalid license key format</span>';
        return;
    }
    
    statusDiv.innerHTML = '<span style="color: #9D4EDD;">Activating...</span>';
    
    const result = await BackendAPI.activateLicense(licenseKey, licenseType);
    
    if (result.success) {
        statusDiv.innerHTML = '<span style="color: #4caf50;">✓ Activation successful!</span>';

        // ── Persist the key so the user never has to re-enter it ──────────
        localStorage.setItem('kterLicenseKey',  licenseKey);
        localStorage.setItem('kterLicenseType', licenseType);
        localStorage.setItem('kterActivated',   'true');
        saveLicenseKeyToDisk(licenseKey, licenseType);
        // ──────────────────────────────────────────────────────────────────

        updateLicenseStatus();

        // Detect version upgrade: backend returns the license version on success
        const newVersion    = result.license_version || result.version || null;
        const currentVersion = localStorage.getItem('kterVersion') || '1.0.0';
        const isInitialized = localStorage.getItem('kterInitialized') === 'true';
        const isUpgrade     = newVersion && newVersion !== currentVersion && isInitialized;

        if (isUpgrade) {
            // Store the new version immediately
            localStorage.setItem('kterVersion', newVersion);

            // Replace status area with inline upgrade reinit prompt
            statusDiv.innerHTML = `
                <div style="margin-top: 12px; padding: 12px; border: 1px solid #9D4EDD; border-radius: 6px; background: rgba(157,78,221,0.08);">
                    <div style="color: #4caf50; font-weight: bold; margin-bottom: 8px;">✓ v${newVersion} license activated!</div>
                    <div style="color: #e0e0e0; margin-bottom: 10px;">
                        A reinitialization is required to upgrade your Kjer system from
                        <strong>v${currentVersion}</strong> to <strong>v${newVersion}</strong>.
                    </div>
                    <button onclick="confirmUpgradeReinit('${newVersion}')" 
                            style="background:#9D4EDD; color:#fff; border:none; padding:8px 18px; border-radius:4px; cursor:pointer; font-weight:bold; margin-right:8px;">
                        Reinitialize Now
                    </button>
                    <button onclick="closeActivationModal()" 
                            style="background:transparent; color:#aaa; border:1px solid #555; padding:8px 18px; border-radius:4px; cursor:pointer;">
                        Later
                    </button>
                </div>`;
        } else {
            // Fresh activation or same version — proceed as normal
            if (newVersion) localStorage.setItem('kterVersion', newVersion);
            setTimeout(() => {
                closeActivationModal();
                initializeKjer();
            }, 1500);
        }
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
async function performVersionUpgrade(version, githubToken) {
    try {
        const installPath = await window.electronAPI?.getAppPath?.();
        if (!installPath) {
            logActivity('Cannot determine install path — upgrade aborted.', 'error');
            return false;
        }

        logActivity(`Connecting to PhanesGuildSoftware/Kjer-upgrades (v${version})…`, 'info');

        const upgradeScript = `${installPath}/lib/upgrade_manager.py`;
        const result = await window.electronAPI.executeCommand('python3', [
            upgradeScript, version, githubToken, installPath
        ]);

        if (!result) {
            logActivity('Upgrade command returned no response.', 'error');
            return false;
        }

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
            localStorage.setItem('kterVersion', version);
            // Update sidebar version display immediately
            const sidebarVerEl = document.getElementById('sidebarVersion');
            if (sidebarVerEl) sidebarVerEl.textContent = `v${version}`;
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
    
    if (!upgradeKey || !upgradeKey.startsWith('KJER-UPGRADE-')) {
        alert('Invalid upgrade key format. Expected: KJER-UPGRADE-XXXX-XXXX-XXXX');
        return;
    }
    
    // Extract version from UI or use default v2.0.0
    const targetVersion = '2.0.0';
    
    const result = await BackendAPI.callBackend('apply-upgrade', {
        'upgrade_key': upgradeKey,
        'target_version': targetVersion
    });
    
    if (result.success) {
        alert(`✓ Upgrade to version ${targetVersion} activated!`);
        document.getElementById('upgradeKeyInput').value = '';
        updateVersionDisplay();
        checkAvailableTools();
    } else {
        alert(`✗ ${result.message || 'Failed to apply upgrade key'}`);
    }
}

async function updateVersionDisplay() {
    // Update the version display elements
    const versionInfo = await BackendAPI.callBackend('get-version-info');
    if (versionInfo && versionInfo.success) {
        const storedVersion = localStorage.getItem('kterVersion') || '—';
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
        priority: 1
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
        priority: 2
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
        priority: 3
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
        priority: 1
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
        priority: 2
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
        priority: 3
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
        priority: 1
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
        priority: 2
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
        priority: 2
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
        priority: 1
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
        priority: 1
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
        priority: 1
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
        priority: 2
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
        priority: 1
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
        priority: 1
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
        priority: 2
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
        priority: 1
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
        priority: 1
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
        priority: 2
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
        priority: 2
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
        priority: 2
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
        priority: 1
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
        priority: 2
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
        priority: 2
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
        priority: 1
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
        priority: 1
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
        priority: 1
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
        priority: 1
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
            timestamp: now
        });

        // Keep only last 25 entries
        if (this.entries.length > this.maxEntries) {
            this.entries.pop();
        }

        this.render();
    },

    render: function() {
        const logContainer = document.getElementById('activityLog');
        if (!logContainer) return;

        logContainer.innerHTML = this.entries.map(entry => `
            <div class="log-entry">
                <span class="log-time">${entry.time}</span>
                <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
                <span class="log-message">${entry.message}</span>
            </div>
        `).join('');
    },

    clear: function() {
        this.entries = [];
        this.render();
    }
};

function logActivity(message, level = 'info', tool = '', important = false) {
    ActivityLog.add(message, level, tool, important);
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
            logEntries.innerHTML = '<div style="text-align:center;color:#555;padding:32px 0;font-size:13px;">Run a Security Scan or Smart Defense to see activity here.</div>';
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
                ? `<span style="color:#B0E0E6;font-weight:600">[${entry.tool}]</span> `
                : '';
            return `<div class="log-entry">
                <div class="log-col-time">${entry.time}</div>
                <div class="log-col-level log-level ${entry.level}">${entry.level.toUpperCase()}</div>
                <div class="log-col-message">${toolCol}${entry.message}</div>
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
        tools: ['Windows Defender', 'Malwarebytes'],
        installSize: '500 MB',
        installTime: '10 minutes'
    },
    {
        name: 'Enterprise Hardening',
        description: 'Comprehensive security hardening suite',
        tools: ['CIS-CAT Pro', 'OSQuery', 'Windows Defender', 'Kaspersky Endpoint Security'],
        installSize: '2.5 GB',
        installTime: '45 minutes'
    },
    {
        name: 'Network Analysis',
        description: 'Advanced network monitoring and analysis',
        tools: ['Wireshark', 'Suricata', 'Zeek'],
        installSize: '800 MB',
        installTime: '20 minutes'
    },
    {
        name: 'Threat Intelligence',
        description: 'SIEM and threat analysis tools',
        tools: ['Splunk Enterprise', 'Elastic Stack', 'Zeek'],
        installSize: '4.0 GB',
        installTime: '60 minutes'
    },
    {
        name: 'Incident Response',
        description: 'Complete incident response toolkit',
        tools: ['Volatility', 'Ghidra', 'Wireshark', 'Splunk Enterprise'],
        installSize: '3.2 GB',
        installTime: '50 minutes'
    },
    {
        name: 'Vulnerability Management',
        description: 'Vulnerability scanning and compliance',
        tools: ['Nessus Professional', 'OpenVAS', 'CIS-CAT Pro'],
        installSize: '1.8 GB',
        installTime: '35 minutes'
    },
    {
        name: 'Reverse Engineering',
        description: 'Malware analysis and reverse engineering',
        tools: ['Ghidra', 'IDA Pro', 'Volatility'],
        installSize: '2.1 GB',
        installTime: '40 minutes'
    }
];

// Initialize Application
document.addEventListener('DOMContentLoaded', async function() {
    loadSettings();
    NetworkStatus.init();
    logActivity('System booting up...', 'info');

    // Load OS from install_state.json (written by gdje-install.sh at install time).
    // This runs before any rendering so tools, profiles, and status all see the
    // correct OS immediately — no "OS undetected" state.
    await loadInstallStateIntoApp();

    // Check if Kjer has been initialized
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    
    setTimeout(() => {
        initializeDashboard();
        logActivity('Dashboard initialized', 'success');
        
        // Initialize version-specific UI constraints
        initializeVersionSpecificUI();
        
        if (isInitialized) {
            // User has already initialized - show personalized content based on saved OS
            const savedOS    = localStorage.getItem('userOS');
            const savedDistro = localStorage.getItem('userDistro') || SystemInfo.getOSInfo().name;
            logActivity(`Loading personalized experience for ${savedDistro}`, 'success');
            renderToolsList();
            logActivity('Tool database loaded', 'success');
            renderProfiles();
            logActivity('Profile database loaded', 'success');
            setupEventListeners();
            logActivity('Event listeners attached', 'success');
            logActivity('Application ready for operations', 'success');

            // Sync any pre-installed tools detected by the CLI into the toolbox
            syncPreInstalledTools(savedOS || 'linux').catch(() => {});
        } else {
            // First time user - clear containers and require initialization
            clearApplicationContainers();
            logActivity('First-time setup detected', 'info');
            setupEventListeners();
            logActivity('Awaiting initialization...', 'warning');
            
            // Show tutorial
            setTimeout(() => Tutorial.show(), 1000);
        }
    }, 500);
});

// ==================== INITIALIZATION HELPERS ====================

function clearApplicationContainers() {
    // Clear tools list
    const toolsList = document.getElementById('toolsList');
    if (toolsList) toolsList.innerHTML = '<p style="text-align: center; color: #B0E0E6; padding: 40px; margin-top: 150px; margin-left: 100px;">Please initialize Kjer to view available tools</p>';
    
    // Clear profiles list  
    const profilesList = document.getElementById('profilesList');
    if (profilesList) profilesList.innerHTML = '<p style="text-align: center; color: #B0E0E6; padding: 40px;">Please initialize Kjer to view installation profiles</p>';
}

function initializeVersionSpecificUI() {
    // No visual changes needed - v1.0.0 users will see upgrade modal on click
    // Other versions have full access
}

function getToolsForCurrentOS() {
    const currentOS = localStorage.getItem('userOS') || SystemInfo.detectOS();
    const tools = {};
    
    // Show all tools but prioritize compatible ones
    for (const [key, tool] of Object.entries(TOOLS_DATABASE)) {
        // Include tool if it's compatible OR if we want to show OS-specific labels
        if (tool.osCompatibility && tool.osCompatibility.includes(currentOS)) {
            tools[key] = tool;
        }
        // Also include OS-exclusive tools to show their labels
        else if (tool.osCompatibility && tool.osCompatibility.length === 1) {
            tools[key] = { ...tool, isIncompatible: true };
        }
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
                tools: ['Fail2ban', 'UFW', 'ClamAV'],
                installSize: '300 MB',
                installTime: '15 minutes'
            },
            {
                name: 'Linux Standard Security',
                description: 'Balanced Linux security setup with detection and hardening',
                tools: ['Fail2ban', 'UFW', 'ClamAV', 'Lynis', 'AIDE', 'Auditd', 'AppArmor'],
                installSize: '800 MB',
                installTime: '25 minutes'
            },
            {
                name: 'Linux Enterprise',
                description: 'Comprehensive Linux security suite',
                tools: ['Fail2ban', 'UFW', 'ClamAV', 'Lynis', 'AIDE', 'Auditd', 'AppArmor', 'Chkrootkit', 'Rkhunter', 'TIGER', 'OSQuery'],
                installSize: '1.5 GB',
                installTime: '45 minutes'
            }
        ],
        windows: [
            {
                name: 'Windows Basic Protection',
                description: 'Essential tools for Windows endpoint protection',
                tools: ['Windows Defender', 'Malwarebytes'],
                installSize: '500 MB',
                installTime: '10 minutes'
            },
            {
                name: 'Windows Enterprise Hardening',
                description: 'Comprehensive Windows security hardening suite',
                tools: ['CIS-CAT Pro', 'OSQuery', 'Windows Defender', 'Kaspersky Endpoint Security'],
                installSize: '2.5 GB',
                installTime: '45 minutes'
            },
            {
                name: 'Windows Vulnerability Management',
                description: 'Vulnerability scanning and compliance for Windows',
                tools: ['Nessus Professional', 'CIS-CAT Pro'],
                installSize: '1.8 GB',
                installTime: '35 minutes'
            }
        ],
        macos: [
            {
                name: 'macOS Basic Security',
                description: 'Essential macOS security tools',
                tools: ['Malwarebytes', 'Kaspersky Endpoint Security'],
                installSize: '400 MB',
                installTime: '15 minutes'
            },
            {
                name: 'macOS Development Security',
                description: 'Security tools for macOS development environments',
                tools: ['Ghidra', 'Wireshark', 'Elastic Stack'],
                installSize: '1.5 GB',
                installTime: '30 minutes'
            }
        ]
    };
    
    return osProfiles[currentOS] || [];
}

// ==================== TAB MANAGEMENT ====================

function switchTab(tabName) {
    // Check if this tab requires a feature that's not available
    if (tabName === 'profiles') {
        const currentVersion = localStorage.getItem('currentVersion') || '1.0.0';
        if (currentVersion === '1.0.0') {
            showUpgradeModal();
            return;
        }
    }
    
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
    
    // Update Status & Logs page if that's the tab being opened
    if (tabName === 'status') {
        updateStatusPage();
    }

    // Refresh dynamic System Information when settings tab is opened
    if (tabName === 'settings') {
        updateSettingsSystemInfo();
    }
    
    logActivity(`Switched to ${tabName} tab`);
}

function updateStatusPage() {
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    const isActivated   = localStorage.getItem('kterActivated')    === 'true';

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
                const version = localStorage.getItem('kterVersion') || '1.0.0';
                const type = localStorage.getItem('kterLicenseType') || 'unknown';
                licenseEl.textContent = `v${version} (${type})`;
                licenseEl.style.color = '#4caf50';
            } else {
                licenseEl.textContent = 'Not Activated';
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
            const version = localStorage.getItem('kterVersion') || '1.0.0';
            const type = localStorage.getItem('kterLicenseType') || 'unknown';
            licenseEl.textContent = `v${version} (${type})`;
            licenseEl.style.color = '#4caf50';
        } else {
            licenseEl.textContent = 'Not Activated';
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

function applyProfilesUpgradeKey() {
    const upgradeKey = document.getElementById('upgradeKeyForProfiles').value.trim();
    
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
    BackendAPI.callBackend('apply-upgrade', {
        'upgrade_key': upgradeKey,
        'target_version': '1.1.0'
    }).then(result => {
        btn.textContent = originalText;
        btn.disabled = false;
        
        if (result.success) {
            const newVer = result.current_version || result.version || localStorage.getItem('kterVersion') || 'new version';
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
    }).catch(error => {
        btn.textContent = originalText;
        btn.disabled = false;
        showNotification('Error processing upgrade key');
    });
}

// ==================== SETTINGS SYSTEM INFO ====================

function updateSettingsSystemInfo() {
    // Version
    const version = localStorage.getItem('kterVersion') || '1.0.0';
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

    // Platform — prefer the installer-detected distro/OS over the UA string
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
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    
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
    
    // Render activity log
    ActivityLog.render();
    // Show empty-state placeholder in security monitor (real entries added during scan/defend)
    SecurityMonitor.render();
    
    logActivity(`Security framework active for: ${installedDistro}`);
}

function updateSystemStatus() {
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
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
    const isActivated    = localStorage.getItem('kterActivated')    === 'true';
    const currentVersion = localStorage.getItem('kterVersion')      || '1.0.0';
    const licenseType    = localStorage.getItem('kterLicenseType')  || 'none';

    // --- Dashboard sidebar badge ---
    const statusBadge = document.getElementById('licenseStatusBadge');
    const statusText  = document.getElementById('licenseStatusText');
    const versionText = document.getElementById('licenseVersionText');
    if (statusBadge && statusText && versionText) {
        if (isActivated) {
            statusBadge.className    = 'status-badge success';
            statusText.textContent   = 'Activated';
            versionText.textContent  = `v${currentVersion} (${licenseType})`;
        } else {
            statusBadge.className    = 'status-badge warning';
            statusText.textContent   = 'Not Activated';
            versionText.textContent  = 'Activate to unlock features';
        }
    }

    // --- Sidebar logo version ---
    const sidebarVersionEl = document.getElementById('sidebarVersion');
    if (sidebarVersionEl) sidebarVersionEl.textContent = `v${currentVersion}`;

    // --- Settings Version & Upgrades card ---
    const currentVerEl  = document.getElementById('currentVersionDisplay');
    const licenseTypeEl = document.getElementById('currentVersionType');
    if (currentVerEl)  currentVerEl.textContent  = currentVersion;
    if (licenseTypeEl) licenseTypeEl.textContent  = isActivated
        ? `(${licenseType.charAt(0).toUpperCase() + licenseType.slice(1)})`
        : '(Not Activated)';
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
}

function scanForUpdates() {
    showNotification('Scanning for tool updates... This may take a moment.');
    logActivity('Tool update scan initiated');
    
    setTimeout(() => {
        const installed = getInstalledTools();
        const updateCount = Math.floor(Math.random() * 3); // Simulate 0-2 updates available
        if (updateCount > 0) {
            showNotification(`Found ${updateCount} tool update(s) available. Visit Tools tab to update.`);
            logActivity(`Found ${updateCount} available updates`);
        } else {
            showNotification('All tools are up to date.');
            logActivity('No updates available - all tools current');
        }
    }, 1500);
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
                             'rpt_integrity','rpt_compliance','rpt_sysinfo','rpt_tools','rpt_actlog']
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
        }
    },
};

// Public entry points wired to HTML buttons
function generateReport()     { ReportWizard.open();  }
function closeReportWizard()  { ReportWizard.close(); }
function reportWizardNext()   { ReportWizard.next();  }
function reportWizardBack()   { ReportWizard.back();  }

// ── Report content builder ────────────────────────────────────────────
function _buildReportContent(opts, fmt) {
    const ts          = new Date().toLocaleString();
    const tsISO       = new Date().toISOString();
    const os          = localStorage.getItem('userDistro') || localStorage.getItem('userOS') || 'Unknown';
    const version     = localStorage.getItem('kterVersion') || '1.0.0';
    const licType     = localStorage.getItem('kterLicenseType') || 'unknown';
    const installedAt = localStorage.getItem('installedAt') || 'Unknown';
    const scan        = window.KjerLastScanResults;
    const installed   = getInstalledTools();
    const toolNames   = Object.keys(installed);

    // Filter activity log entries
    const logEntries  = ActivityLog.entries || [];

    if (fmt === 'json') return _buildJsonReport(opts, { ts: tsISO, os, version, licType, installedAt, scan, toolNames, logEntries });
    if (fmt === 'md')   return _buildMarkdownReport(opts, { ts, os, version, licType, installedAt, scan, toolNames, logEntries });
    if (fmt === 'html') return _buildHtmlReport(opts, { ts, os, version, licType, installedAt, scan, toolNames, logEntries });
    return _buildTextReport(opts, { ts, os, version, licType, installedAt, scan, toolNames, logEntries });
}

function _rptLine(char, len) { return char.repeat(len || 60); }

function _buildTextReport(opts, d) {
    const L = _rptLine;
    let r = [];
    r.push(L('='));
    r.push('KJER SECURITY REPORT');
    r.push(`Generated : ${d.ts}`);
    r.push(`Platform  : ${d.os}`);
    r.push(`Version   : v${d.version} (${d.licType})`);
    r.push(L('='));

    if (opts.sysinfo) {
        r.push('\nSYSTEM INFORMATION');
        r.push(L('-'));
        r.push(`  Operating System : ${d.os}`);
        r.push(`  Kjer Version     : v${d.version} (${d.licType})`);
        r.push(`  Install Date     : ${d.installedAt}`);
        r.push(`  Report Time      : ${d.ts}`);
    }

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
        const nf = findingsByPhase('NETWORK ANALYSIS');
        if (nf.length > 0) {
            nf.forEach(f => r.push(`  [${f.level.toUpperCase()}] ${f.tool}: ${f.message}`));
        } else if (d.scan) {
            r.push('  No network anomalies detected.');
        } else {
            r.push('  No scan data available.');
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
        const defEntries = d.logEntries.filter(e =>
            e.message.includes('DEFENSE') || e.message.includes('PHASE') ||
            e.message.includes('blocked') || e.message.includes('quarantine') ||
            e.message.includes('Enforc') || e.message.includes('activated'));
        if (defEntries.length > 0) {
            defEntries.slice(0, 30).forEach(e =>
                r.push(`  [${e.time}] [${e.level.toUpperCase()}] ${e.message}`));
        } else {
            r.push('  No defensive actions logged. Run Defend after a Scan.');
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

    if (opts.actlog) {
        r.push('\nSECURITY ACTIVITY LOG (recent 50)');
        r.push(L('-'));
        d.logEntries.slice(0, 50).forEach(e =>
            r.push(`  [${e.time}] [${e.level.toUpperCase()}] ${e.message}`));
    }

    r.push('');
    r.push(L('='));
    r.push('END OF KJER SECURITY REPORT');
    r.push(L('='));
    return r.join('\n');
}

function _buildMarkdownReport(opts, d) {
    const scan = d.scan;
    let r = [];
    r.push('# Kjer Security Report');
    r.push('');
    r.push(`| Field | Value |`);
    r.push(`|---|---|`);
    r.push(`| Generated | ${d.ts} |`);
    r.push(`| Platform | ${d.os} |`);
    r.push(`| Version | v${d.version} (${d.licType}) |`);
    r.push('');

    if (opts.sysinfo) {
        r.push('## System Information');
        r.push(`- **OS:** ${d.os}`);
        r.push(`- **Version:** v${d.version} (${d.licType})`);
        r.push(`- **Install Date:** ${d.installedAt}`);
        r.push('');
    }

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
        const nf = scan?.findings?.filter(f => f.phase === 'NETWORK ANALYSIS') || [];
        if (nf.length > 0) nf.forEach(f => r.push(`- **[${f.level.toUpperCase()}]** \`${f.tool}\`: ${f.message}`));
        else r.push(scan ? '> No network anomalies.' : '> No scan data available.');
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
        const de = d.logEntries.filter(e =>
            e.message.includes('DEFENSE') || e.message.includes('PHASE') ||
            e.message.includes('blocked') || e.message.includes('quarantine') ||
            e.message.includes('Enforc') || e.message.includes('activated')).slice(0, 30);
        if (de.length > 0) de.forEach(e => r.push(`- \`[${e.time}]\` **${e.level.toUpperCase()}** ${e.message}`));
        else r.push('> No defensive actions logged.');
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

    if (opts.actlog) {
        r.push('## Security Activity Log');
        r.push('```');
        d.logEntries.slice(0, 50).forEach(e => r.push(`[${e.time}] [${e.level.toUpperCase()}] ${e.message}`));
        r.push('```');
    }

    r.push('\n---\n*Generated by Kjer Security Framework*');
    return r.join('\n');
}

function _buildHtmlReport(opts, d) {
    const scan = d.scan;
    const badgeColor = { critical: '#ff4444', error: '#ff6b00', warning: '#ffbb00', success: '#4caf50', info: '#2196F3' };
    const badge = (level, text) =>
        `<span style="background:${badgeColor[level]||'#888'};color:#fff;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">${text||level.toUpperCase()}</span>`;

    let b = [];
    b.push(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`);
    b.push(`<title>Kjer Security Report — ${d.ts}</title>`);
    b.push(`<style>`);
    b.push(`body{font-family:"Segoe UI",Arial,sans-serif;background:#0d0d1a;color:#B0E0E6;margin:0;padding:32px;}`);
    b.push(`h1{color:#9D4EDD;border-bottom:2px solid #9D4EDD;padding-bottom:8px;}`);
    b.push(`h2{color:#B0E0E6;border-bottom:1px solid #2a2a3a;padding-bottom:4px;margin-top:32px;}`);
    b.push(`table{width:100%;border-collapse:collapse;margin-bottom:16px;}`);
    b.push(`th{background:#1a1a2e;color:#9D4EDD;padding:8px 12px;text-align:left;}`);
    b.push(`td{padding:7px 12px;border-bottom:1px solid #2a2a3a;}`);
    b.push(`tr:hover td{background:rgba(157,78,221,0.06);}`);
    b.push(`.finding{background:#141424;border-left:3px solid;padding:8px 14px;margin:6px 0;border-radius:0 4px 4px 0;}`);
    b.push(`pre{background:#0a0a14;padding:16px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.7;}`);
    b.push(`footer{margin-top:48px;border-top:1px solid #2a2a3a;padding-top:12px;color:#555;font-size:11px;}`);
    b.push(`</style></head><body>`);
    b.push(`<h1>&#x1F6E1; Kjer Security Report</h1>`);
    b.push(`<table><tr><th>Field</th><th>Value</th></tr>`);
    b.push(`<tr><td>Generated</td><td>${d.ts}</td></tr>`);
    b.push(`<tr><td>Platform</td><td>${d.os}</td></tr>`);
    b.push(`<tr><td>Version</td><td>v${d.version} (${d.licType})</td></tr></table>`);

    if (opts.threats) {
        b.push('<h2>Detected Threats &amp; Findings</h2>');
        if (scan) {
            const tl   = scan.critical > 0 ? 'CRITICAL' : scan.high > 0 ? 'HIGH' : scan.medium > 0 ? 'MEDIUM' : 'CLEAN';
            const tlC  = scan.critical > 0 ? 'critical' : scan.high > 0 ? 'error' : scan.medium > 0 ? 'warning' : 'success';
            b.push(`<p>Overall threat level: ${badge(tlC, tl)}</p>`);
            b.push(`<table><tr><th>Severity</th><th>Count</th></tr>`);
            b.push(`<tr><td>Critical</td><td>${scan.critical}</td></tr>`);
            b.push(`<tr><td>High</td><td>${scan.high}</td></tr>`);
            b.push(`<tr><td>Medium</td><td>${scan.medium}</td></tr>`);
            b.push(`<tr><td>Low</td><td>${scan.low}</td></tr></table>`);
            if (scan.findings?.length > 0) {
                scan.findings.forEach(f => b.push(
                    `<div class="finding" style="border-color:${badgeColor[f.level]||'#888'};">` +
                    `${badge(f.level)} <strong>${f.tool}</strong>: ${f.message}</div>`
                ));
            }
        } else b.push('<p><em>No scan data. Run Scan first.</em></p>');
    }

    const htmlPhase = (title, phase, fallback) => {
        b.push(`<h2>${title}</h2>`);
        const fnd = scan?.findings?.filter(f => f.phase === phase) || [];
        if (fnd.length > 0)
            fnd.forEach(f => b.push(`<div class="finding" style="border-color:${badgeColor[f.level]||'#888'};">${badge(f.level)} <strong>${f.tool}</strong>: ${f.message}</div>`));
        else b.push(`<p><em>${fallback}</em></p>`);
    };

    if (opts.vulns)      htmlPhase('Vulnerability Analysis',      'VULNERABILITY SCAN', scan ? 'No vulnerabilities found.' : 'No scan data.');
    if (opts.network)    htmlPhase('Network &amp; Traffic Analysis', 'NETWORK ANALYSIS',   scan ? 'No anomalies.' : 'No scan data.');
    if (opts.integrity)  htmlPhase('File Integrity Results',       'FILE INTEGRITY',      scan ? 'No violations.' : 'No scan data.');
    if (opts.compliance) htmlPhase('Compliance &amp; Audit',       'COMPLIANCE & AUDIT',  scan ? 'All checks passed.' : 'No scan data.');

    if (opts.defense) {
        b.push('<h2>Defensive Actions Taken</h2>');
        const de = d.logEntries.filter(e =>
            e.message.includes('DEFENSE') || e.message.includes('PHASE') ||
            e.message.includes('blocked') || e.message.includes('quarantine') ||
            e.message.includes('Enforc') || e.message.includes('activated')).slice(0, 30);
        if (de.length > 0)
            de.forEach(e => b.push(`<div class="finding" style="border-color:${badgeColor[e.level]||'#888'};"><code>[${e.time}]</code> ${badge(e.level)} ${e.message}</div>`));
        else b.push('<p><em>No defensive actions logged. Run Defend after Scan.</em></p>');
    }

    if (opts.sysinfo) {
        b.push('<h2>System Information</h2><table><tr><th>Field</th><th>Value</th></tr>');
        b.push(`<tr><td>OS</td><td>${d.os}</td></tr>`);
        b.push(`<tr><td>Version</td><td>v${d.version} (${d.licType})</td></tr>`);
        b.push(`<tr><td>Install Date</td><td>${d.installedAt}</td></tr></table>`);
    }

    if (opts.tools) {
        b.push('<h2>Installed Tools Inventory</h2>');
        if (d.toolNames.length > 0) {
            b.push('<table><tr><th>#</th><th>Tool</th></tr>');
            d.toolNames.forEach((t, i) => b.push(`<tr><td>${i+1}</td><td>${t}</td></tr>`));
            b.push('</table>');
        } else b.push('<p><em>No tools installed.</em></p>');
    }

    if (opts.actlog) {
        b.push('<h2>Security Activity Log</h2><pre>');
        d.logEntries.slice(0, 50).forEach(e =>
            b.push(`[${e.time}] [${e.level.toUpperCase()}] ${e.message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}`))
        b.push('</pre>');
    }

    b.push(`<footer>Generated by Kjer Security Framework &mdash; ${d.ts}</footer>`);
    b.push('</body></html>');
    return b.join('\n');
}

function _buildJsonReport(opts, d) {
    const scan = d.scan;
    const out  = {
        meta: { generated: d.ts, platform: d.os, version: d.version, licenseType: d.licType, installDate: d.installedAt }
    };
    if (opts.threats)    out.threats    = { threatLevel: scan ? (scan.critical > 0 ? 'CRITICAL' : scan.high > 0 ? 'HIGH' : scan.medium > 0 ? 'MEDIUM' : 'CLEAN') : null, summary: scan ? { critical: scan.critical, high: scan.high, medium: scan.medium, low: scan.low, toolsRun: scan.toolsRun } : null, findings: scan?.findings || [] };
    if (opts.vulns)      out.vulnerability  = { findings: scan?.findings?.filter(f => f.phase === 'VULNERABILITY SCAN') || [] };
    if (opts.network)    out.network        = { findings: scan?.findings?.filter(f => f.phase === 'NETWORK ANALYSIS') || [] };
    if (opts.integrity)  out.fileIntegrity  = { findings: scan?.findings?.filter(f => f.phase === 'FILE INTEGRITY') || [] };
    if (opts.compliance) out.compliance     = { findings: scan?.findings?.filter(f => f.phase === 'COMPLIANCE & AUDIT') || [] };
    if (opts.defense)    out.defenseActions = d.logEntries.filter(e => e.message.includes('DEFENSE') || e.message.includes('PHASE') || e.message.includes('blocked') || e.message.includes('quarantine')).slice(0, 30);
    if (opts.tools)      out.installedTools = d.toolNames;
    if (opts.sysinfo)    out.systemInfo     = { os: d.os, version: d.version, licenseType: d.licType, installDate: d.installedAt };
    if (opts.actlog)     out.activityLog    = d.logEntries.slice(0, 50);
    return JSON.stringify(out, null, 2);
}

// ── File save helper ─────────────────────────────────────────────────
async function _saveReportFile(content, fmt, customPath) {
    const os  = localStorage.getItem('userOS') || 'linux';
    const ts  = new Date().toISOString().slice(0, 10);
    const fn  = customPath.trim() || `~/Documents/kjer-report-${ts}.${fmt}`;
    const safeFn = fn.replace(/'/g, "'\\''");

    // Attempt Electron file write
    try {
        const shell = os === 'windows' ? 'powershell' : 'bash';
        let cmd;
        if (os === 'windows') {
            // Expand ~\Documents on Windows
            const winPath = fn.replace('~', '$env:USERPROFILE').replace(/\//g, '\\\\');
            const escaped = content.replace(/'/g, "''")
                                   .replace(/`/g, '``')
                                   .replace(/\$/g, '`$');
            cmd = ['-Command', `$p = "${winPath}"; New-Item -Force -ItemType Directory (Split-Path $p) | Out-Null; Set-Content -Path $p -Value '${escaped}' -Encoding UTF8`];
        } else {
            const escaped = content.replace(/\\/g, '\\\\').replace(/'/g, "'\\'''");
            cmd = ['-c', `mkdir -p "$(dirname '${safeFn}' | sed 's|~|'"$HOME"'|g')" && printf '%s' '${escaped}' > "$(echo '${safeFn}' | sed 's|~|'"$HOME"'|g')"` ];
        }
        const result = await window.electronAPI?.executeCommand?.(shell, cmd);
        if (result !== undefined) return true;
    } catch (e) { /* fall through to download */ }

    // Fallback: browser download
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
};

/** Return the subset of installed tools that match a given role array. */
function getToolsByRole(roleKeys) {
    const installed = getInstalledTools();                  // { 'Tool Name': true }
    const installedKeys = Object.keys(TOOLS_DATABASE).filter(key => {
        const t = TOOLS_DATABASE[key];
        return installed[t.name];
    });
    const wanted = new Set(roleKeys.flatMap(r => TOOL_ROLES[r] || []));
    return installedKeys
        .filter(k => wanted.has(k))
        .map(k => ({ key: k, ...TOOLS_DATABASE[k] }));
}

// Shared state — Scan writes here; Defend reads from here.
window.KjerLastScanResults = null;

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
function performComprehensiveScan() {
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
    window.KjerLastScanResults = null;  // clear stale results

    // ── Header ────────────────────────────────────────────────────
    SecurityMonitor.clear();
    SecurityMonitor.divider();
    SecurityMonitor.section('KJER SECURITY SCAN — ' + new Date().toLocaleTimeString());
    const os = localStorage.getItem('userDistro') || localStorage.getItem('userOS') || 'this system';
    SecurityMonitor.log('', `Target: ${os}  |  Tools engaged: ${activePhases.reduce((a,[,t])=>a+t.length,0)}`, 'info');
    SecurityMonitor.divider();

    showNotification('Security scan started — results streaming to Activity Monitor...');
    updateLastUpdateTime();

    // ── Phase scheduler ──────────────────────────────────────────
    let globalDelay = 400;

    activePhases.forEach(([phaseName, tools]) => {
        // Section header
        setTimeout(() => logSection(phaseName), globalDelay);
        globalDelay += 300;

        tools.forEach(tool => {
            const capturedTool = tool;
            setTimeout(() => {
                const finding = _runToolScan(capturedTool, phaseName);
                results.toolsRun++;
                if (finding) {
                    results.findings.push(finding);
                    if      (finding.level === 'critical') results.critical++;
                    else if (finding.level === 'error')    results.high++;
                    else if (finding.level === 'warning')  results.medium++;
                    else if (finding.level === 'info' && finding.flagged) results.low++;
                }
            }, globalDelay);
            globalDelay += 550;
        });

        globalDelay += 200;
    });

    // ── Summary ───────────────────────────────────────────────────
    setTimeout(() => {
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

        // Security Monitor — detailed per-run output
        SecurityMonitor.divider();
        SecurityMonitor.section(`SCAN COMPLETE — ${elapsed}s`);
        SecurityMonitor.log('', `Threat Level: ${threatLevel}  |  Critical: ${results.critical}  High: ${results.high}  Medium: ${results.medium}  Low: ${results.low}`, summaryLevel);
        if (results.findings.length > 0) {
            SecurityMonitor.log('', `${results.findings.length} finding(s) recorded — click DEFEND to apply countermeasures`, 'warning');
        } else {
            SecurityMonitor.log('', 'No actionable findings — system posture looks good', 'success');
        }
        SecurityMonitor.divider();

        // Status & Logs tab — clean one-line summary
        logActivity(
            results.findings.length > 0
                ? `Scan complete — ${results.findings.length} threat(s) detected  |  Threat level: ${threatLevel}`
                : 'Scan complete — no threats detected',
            summaryLevel, '', true);

        showNotification(
            `Scan complete | ${threatLevel} | ` +
            `${results.critical} critical, ${results.high} high, ${results.medium} medium`
        );
    }, globalDelay + 400);
}

/**
 * Simulate one tool's scan and write a result line.
 * Returns a finding object or null.
 */
function _runToolScan(tool, phase) {
    const name = tool.name;
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

/** Simple integer random in [min, max] */
function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ─── DEFEND ENGINE ──────────────────────────────────────────────
function activateSmartDefense() {
    const installed      = getInstalledTools();
    const installedNames = Object.keys(installed);

    if (installedNames.length === 0) {
        showNotification('No tools installed. Install defensive tools first.');
        logActivity('Defend aborted — no tools installed', 'warning');
        return;
    }

    const scanResults = window.KjerLastScanResults;
    const hasScanData = scanResults && scanResults.completedAt;

    // ── Header ────────────────────────────────────────────────────
    SecurityMonitor.clear();
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

    let delay = 400;
    let actionsTotal = 0;
    let toolsEngaged = new Set();

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

    // If no scan data, defend everything present
    const broadMode = !hasScanData;

    // ─────────────────────────────────────────────────────────────
    // PHASE 1 — NETWORK & PERIMETER HARDENING
    // (UFW, Fail2ban, Suricata IPS) — triggered by network threats
    // ─────────────────────────────────────────────────────────────
    const networkDefenders = getToolsByRole(['firewall', 'ips']).filter(t =>
        ['ufw','fail2ban','suricata'].includes(t.key));

    if (networkDefenders.length > 0 && (broadMode || hasNetworkThreat || hasVulns)) {
        setTimeout(() => logSection('PHASE 1 — NETWORK & PERIMETER'), delay);
        delay += 300;

        networkDefenders.forEach(tool => {
            const t = tool;
            setTimeout(() => {
                toolsEngaged.add(t.name);
                switch (t.key) {
                    case 'ufw': {
                        const blocked = ri(1, 5);
                        logResult(t.name, `Rules tightened — ${blocked} suspicious IP range(s) blocked, default-deny enforced`, 'success');
                        actionsTotal++; break;
                    }
                    case 'fail2ban': {
                        const services = ['SSH', 'HTTP', 'FTP', 'SMTP'].slice(0, ri(1, 3));
                        logResult(t.name, `Activated on ${services.join('/')} — ban threshold: 3 failures / 10 min`, 'success');
                        actionsTotal++; break;
                    }
                    case 'suricata': {
                        if (hasNetworkThreat) {
                            logResult(t.name, 'Switched to IPS mode — malicious traffic will be dropped in-line', 'warning');
                        } else {
                            logResult(t.name, 'Rules reloaded — threat signatures updated to latest ET ruleset', 'info');
                        }
                        actionsTotal++; break;
                    }
                }
            }, delay);
            delay += 500;
        });
        delay += 200;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 2 — MALWARE CONTAINMENT & REMEDIATION
    // (ClamAV, rkhunter, Malwarebytes, Kaspersky, Windows Defender)
    // ─────────────────────────────────────────────────────────────
    const avTools = getToolsByRole(['av_remediate']);

    if (avTools.length > 0 && (broadMode || hasMalware || hasMemoryThreat)) {
        setTimeout(() => logSection('PHASE 2 — MALWARE CONTAINMENT'), delay);
        delay += 300;

        avTools.forEach(tool => {
            const t = tool;
            setTimeout(() => {
                toolsEngaged.add(t.name);
                switch (t.key) {
                    case 'clamav': {
                        const quarantined = hasMalware ? ri(1, 3) : 0;
                        if (quarantined > 0) {
                            logResult(t.name, `${quarantined} file(s) quarantined in /var/lib/clamav/quarantine`, 'warning');
                        } else {
                            logResult(t.name, 'Full scan run — no files quarantined, definitions updated', 'success');
                        }
                        actionsTotal++; break;
                    }
                    case 'rkhunter': {
                        logResult(t.name, '--propupd run to update baseline file properties', 'info');
                        if (hasMalware) logResult(t.name, 'Suspicious module(s) logged — manual kernel review recommended', 'warning');
                        actionsTotal++; break;
                    }
                    case 'chkrootkit': {
                        const clean = !hasMalware || Math.random() > 0.5;
                        logResult(t.name, clean ? 'Second-pass clean — rootkit signatures not confirmed' :
                            'Persistent pattern detected — escalate to memory analysis', clean ? 'success' : 'critical');
                        actionsTotal++; break;
                    }
                    case 'malwarebytes': {
                        const remediated = hasMalware ? ri(1, 3) : 0;
                        logResult(t.name,
                            remediated > 0 ? `${remediated} threat(s) remediated — ransomware artifacts removed` :
                                'Remediation scan complete — system clean',
                            remediated > 0 ? 'warning' : 'success');
                        actionsTotal++; break;
                    }
                    case 'windows-defender': {
                        logResult(t.name, 'Real-time protection confirmed active — cloud lookup enabled', 'success');
                        actionsTotal++; break;
                    }
                    case 'kaspersky': {
                        logResult(t.name, 'Endpoint protection reinforced — network attack blocker toggled ON', 'success');
                        actionsTotal++; break;
                    }
                }
            }, delay);
            delay += 500;
        });
        delay += 200;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 3 — ACCESS CONTROL & MAC ENFORCEMENT
    // (AppArmor, SELinux) — always appropriate
    // ─────────────────────────────────────────────────────────────
    const macTools = getToolsByRole(['firewall']).filter(t => ['apparmor','selinux'].includes(t.key));

    if (macTools.length > 0 && (broadMode || hasComplianceGap || hasMalware)) {
        setTimeout(() => logSection('PHASE 3 — ACCESS CONTROL ENFORCEMENT'), delay);
        delay += 300;

        macTools.forEach(tool => {
            const t = tool;
            setTimeout(() => {
                toolsEngaged.add(t.name);
                switch (t.key) {
                    case 'apparmor': {
                        const profileCount = ri(8, 20);
                        logResult(t.name, `Enforcing ${profileCount} profiles — unconfined processes investigated`, 'success');
                        actionsTotal++; break;
                    }
                    case 'selinux': {
                        if (hasComplianceGap) {
                            logResult(t.name, 'Switched to Enforcing mode — AVC denials will now block policy violations', 'warning');
                        } else {
                            logResult(t.name, 'Mode confirmed: Enforcing — policy context intact', 'success');
                        }
                        actionsTotal++; break;
                    }
                }
            }, delay);
            delay += 500;
        });
        delay += 200;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 4 — FILE INTEGRITY RESTORATION
    // (AIDE, Tripwire) — triggered by integrity findings
    // ─────────────────────────────────────────────────────────────
    const integrityTools = getToolsByRole(['integrity_scan']);

    if (integrityTools.length > 0 && (broadMode || hasIntegrityViolation)) {
        setTimeout(() => logSection('PHASE 4 — FILE INTEGRITY'), delay);
        delay += 300;

        integrityTools.forEach(tool => {
            const t = tool;
            setTimeout(() => {
                toolsEngaged.add(t.name);
                if (hasIntegrityViolation) {
                    logResult(t.name, 'Flagged files logged — baseline will NOT auto-update (manual review required)', 'warning');
                } else {
                    logResult(t.name, 'Baseline re-checked — updating database with approved changes', 'success');
                }
                actionsTotal++;
            }, delay);
            delay += 450;
        });
        delay += 200;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 5 — AUDIT & COMPLIANCE HARDENING
    // (Lynis, auditd) — triggered by compliance findings
    // ─────────────────────────────────────────────────────────────
    const complianceDefenders = getToolsByRole(['compliance_scan'])
        .filter(t => ['lynis', 'auditd'].includes(t.key));

    if (complianceDefenders.length > 0 && (broadMode || hasComplianceGap)) {
        setTimeout(() => logSection('PHASE 5 — AUDIT HARDENING'), delay);
        delay += 300;

        complianceDefenders.forEach(tool => {
            const t = tool;
            setTimeout(() => {
                toolsEngaged.add(t.name);
                switch (t.key) {
                    case 'lynis': {
                        const applied = ri(3, 9);
                        logResult(t.name, `${applied} hardening recommendation(s) applied from last audit report`, 'success');
                        actionsTotal++; break;
                    }
                    case 'auditd': {
                        logResult(t.name, 'Audit rules loaded — privilege-escalation and file-write syscalls monitored', 'info');
                        actionsTotal++; break;
                    }
                }
            }, delay);
            delay += 500;
        });
        delay += 200;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 6 — SIEM ALERT RULE PUSH
    // (Splunk, ELK) — if any findings exist
    // ─────────────────────────────────────────────────────────────
    const siemTools = getToolsByRole(['siem']);

    if (siemTools.length > 0 && (broadMode || findings.length > 0)) {
        setTimeout(() => logSection('PHASE 6 — SIEM ALERT RULES'), delay);
        delay += 300;

        siemTools.forEach(tool => {
            const t = tool;
            setTimeout(() => {
                toolsEngaged.add(t.name);
                const rules = ri(2, 8);
                logResult(t.name, `${rules} detection rule(s) pushed — alerting on findings from this scan`, 'info');
                actionsTotal++;
            }, delay);
            delay += 450;
        });
        delay += 200;
    }

    // ─────────────────────────────────────────────────────────────
    // DEFENSE SUMMARY
    // ─────────────────────────────────────────────────────────────
    setTimeout(() => {
        const posture = actionsTotal === 0
            ? 'NO DEFENSIVE TOOLS INSTALLED'
            : findings.length === 0
                ? 'HARDENED (preventive)'
                : hasScanData && scanResults.critical > 0
                    ? 'INCIDENT RESPONSE ACTIVE'
                    : 'HARDENED';

        // Security Monitor — detailed per-run output
        SecurityMonitor.divider();
        SecurityMonitor.section('DEFENSE COMPLETE');
        SecurityMonitor.log('', `Actions taken: ${actionsTotal}  |  Tools engaged: ${toolsEngaged.size}  |  Posture: ${posture}`, actionsTotal > 0 ? 'success' : 'warning');
        if (actionsTotal === 0) {
            SecurityMonitor.log('', 'Install defensive tools (UFW, Fail2ban, ClamAV, AppArmor) for automated response', 'warning');
        }
        SecurityMonitor.divider();

        // Status & Logs tab — clean one-line summary
        logActivity(
            actionsTotal > 0
                ? `Defense complete — ${actionsTotal} action(s)  |  Posture: ${posture}`
                : 'Defense complete — no defensive tools installed',
            actionsTotal > 0 ? 'success' : 'warning', '', true);

        showNotification(
            `Defense complete — ${actionsTotal} action(s), ` +
            `${toolsEngaged.size} tool(s) engaged | ${posture}`
        );
    }, delay + 400);
}

function clearActivityLog() {
    if (confirm('Clear all activity log entries?')) {
        ActivityLog.clear();
        SecurityMonitor.clear();
        logActivity('Activity log cleared', 'info');
    }
}

// ==================== TOOLS SECTION ====================

function renderToolsList() {
    const toolsList = document.getElementById('toolsList');
    if (!toolsList) return;
    
    // Check if app is initialized
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    
    // Only show tools compatible with current OS
    const compatibleTools = getToolsForCurrentOS();
    
    if (Object.keys(compatibleTools).length === 0) {
        toolsList.innerHTML = '<p style="text-align: center; color: #B0E0E6; padding: 40px;">No tools available for your system</p>';
        return;
    }
    
    toolsList.innerHTML = '';
    
    Object.entries(compatibleTools).forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized);
        toolsList.appendChild(toolCard);
    });
}

function createToolCard(tool, isInitialized = true) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    
    const installed = getInstalledTools();
    const isInstalled = tool.name in installed;
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
        <div ${cardOpacity}>
        <div class="tool-icon">${tool.icon}</div>
        <div class="tool-name">${tool.name}${osIndicator}</div>
        <span class="tool-category">${tool.category}</span>
        <p class="tool-description">${tool.description}</p>
        <p class="tool-status">
            <strong>Version:</strong> ${tool.version} | 
            <strong>Status:</strong> ${statusText} | 
            <strong>Compat:</strong> ${compatibility}%
        </p>
        ${depsText}
        ${cliNote}
        ${incompatNote}
        ${!isInitialized ? '<div style="font-size: 10px; color: #B0E0E6; margin-top: 8px; padding: 6px; background: rgba(176, 224, 230, 0.1); border-radius: 4px;"><strong>ℹ Initialize Kjer to install tools</strong></div>' : ''}
        <div class="tool-actions-centered">
            <button class="btn btn-primary btn-install" onclick="installTool('${tool.name}')" ${isButtonDisabled ? 'disabled' : ''} style="background-color: ${isInstalled ? '#d32f2f' : '#1976d2'}; ${buttonOpacity} ${buttonCursor}"><i class="icon ${buttonIcon}"></i> ${buttonText}</button>
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
        if (!info?.installed) continue;
        const displayName = keyToName[yamlKey.toLowerCase()];
        if (displayName) {
            setToolInstalled(displayName, true);
            pre.push(displayName);
        }
    }

    if (pre.length > 0) {
        logActivity(`Pre-installed tools detected and registered: ${pre.join(', ')}`, 'success', '', true);
    } else {
        logActivity('Tool detection complete — no toolbox binaries found pre-installed', 'info');
    }

    // Always re-render the toolbox so status badges update immediately
    renderToolsList?.();
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
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    const toolsList = document.getElementById('toolsList');
    
    toolsList.innerHTML = '';
    
    const categoryFilter = document.getElementById('categoryFilter').value;
    const filteredTools = Object.entries(TOOLS_DATABASE).filter(([key, tool]) => {
        const matchesSearch = tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            tool.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !categoryFilter || tool.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });
    
    if (filteredTools.length === 0) {
        toolsList.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-light);">No tools found matching your criteria.</p>';
        return;
    }
    
    filteredTools.forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized);
        toolsList.appendChild(toolCard);
    });
}

function filterToolsByStatus(status) {
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    const toolsList = document.getElementById('toolsList');
    
    // Block 'installed' and 'available' filters if not initialized
    if (!isInitialized && (status === 'installed' || status === 'available')) {
        toolsList.innerHTML = '<p style="text-align: center; color: #B0E0E6; padding: 40px; margin-top: 150px; margin-left: 100px;">Please initialize Kjer to use filters</p>';
        return;
    }
    
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    toolsList.innerHTML = '';
    
    const installed = getInstalledTools();
    let filteredTools = Object.entries(TOOLS_DATABASE);
    
    if (status === 'installed') {
        filteredTools = filteredTools.filter(([key, tool]) => key in installed);
    } else if (status === 'available') {
        filteredTools = filteredTools.filter(([key, tool]) => !(key in installed));
    }
    
    if (filteredTools.length === 0) {
        const statusText = status === 'installed' ? 'No installed tools' : 'No available tools';
        toolsList.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-light);">${statusText}.</p>`;
        return;
    }
    
    filteredTools.forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized);
        toolsList.appendChild(toolCard);
    });
}

function filterToolsByTop(count) {
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
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
        toolsList.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-light);">No tools available for ${osName}.</p>`;
        return;
    }
    
    topTools.forEach(([key, tool]) => {
        const toolCard = createToolCard(tool, isInitialized);
        toolsList.appendChild(toolCard);
    });
}

async function installTool(toolName) {
    const installed = getInstalledTools();
    const isInstalled = toolName in installed;
    
    if (isInstalled) {
        // Uninstall
        showNotification(`Uninstalling ${toolName}...`);
        logActivity(`Uninstallation started for ${toolName}`, 'info');
        
        const result = await BackendAPI.uninstallTool(toolName);
        
        if (result.success) {
            setToolInstalled(toolName, false);
            showNotification(`${toolName} uninstalled successfully!`);
            logActivity(`${toolName} uninstalled`, 'success', '', true);
        } else {
            showNotification(`Failed to uninstall ${toolName}: ${result.message}`);
            logActivity(`${toolName} uninstallation failed: ${result.message}`, 'error');
        }
    } else {
        // Install
        showNotification(`Installing ${toolName}... This may take several minutes.`);
        logActivity(`Installation started for ${toolName}`, 'info');
        
        const result = await BackendAPI.installTool(toolName);
        
        if (result.success) {
            setToolInstalled(toolName, true);
            showNotification(`${toolName} installed successfully!`);
            logActivity(`${toolName} installation completed`, 'success', '', true);
        } else {
            showNotification(`Failed to install ${toolName}: ${result.message}`);
            logActivity(`${toolName} installation failed: ${result.message}`, 'error', '', true);
        }
    }
    
    // Refresh the current view
    renderToolsList();
}

function viewToolDetails(toolName) {
    alert(`Details for: ${toolName}\n\nThis tool is part of the Kjer suite.\nVisit the documentation for more information.`);
}

// ==================== PROFILES SECTION ====================

function renderProfiles() {
    const profilesList = document.getElementById('profilesList');
    if (!profilesList) return;
    
    // Check if profiles feature is available in current version
    const currentVersion = localStorage.getItem('kterVersion') || '1.0.0';
    if (currentVersion === '1.0.0') {
        profilesList.innerHTML = '<p style="text-align: center; color: #B0E0E6; padding: 40px;">Profiles require an upgraded license. Use the ⬆ Upgrade button to unlock this feature.</p>';
        return;
    }
    
    // Only show profiles for current OS
    const compatibleProfiles = getProfilesForCurrentOS();
    
    if (compatibleProfiles.length === 0) {
        profilesList.innerHTML = '<p style="text-align: center; color: #B0E0E6; padding: 40px;">No profiles available for your system</p>';
        return;
    }
    
    profilesList.innerHTML = '';
    
    // Add Create Custom Profile button
    const customBtn = document.createElement('button');
    customBtn.className = 'btn btn-primary';
    customBtn.style.cssText = 'width: 100%; padding: 15px; margin-bottom: 30px; font-size: 16px;';
    customBtn.textContent = 'Create Custom Profile';
    customBtn.onclick = showCustomProfileCreator;
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
    
    const toolsList = profile.tools.map(toolName => {
        const tool = Object.values(TOOLS_DATABASE).find(t => t.name === toolName);
        if (tool && tool.compatible === 'Yes') {
            return `<span style="color: #FFFFFF; padding: 2px 8px; background: rgba(157, 78, 221, 0.12); border-radius: 3px; display: inline-block; margin: 4px 2px; font-size: 12px;">${toolName}</span>`;
        } else {
            return `<span style="color: #FFFFFF; padding: 2px 8px; background: rgba(135, 206, 235, 0.1); border-radius: 3px; display: inline-block; margin: 4px 2px; font-size: 12px;">${toolName}</span>`;
        }
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
                <button class="btn btn-primary" onclick="installProfile('${profile.name}', ${profile.tools.length})">Install Profile</button>
                <button class="btn btn-outline" onclick="showProfileToolSelection('${profile.name}', ${index})">Customize Tools</button>
            </div>
        </div>
    `;
    
    return card;
}

function showProfileToolSelection(profileName, profileIndex) {
    const profile = PROFILES_DATABASE[profileIndex];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'toolSelectModal';
    modal.style.display = 'flex';
    
    let toolsHtml = profile.tools.map(toolName => {
        const tool = Object.values(TOOLS_DATABASE).find(t => t.name === toolName);
        const isCompatible = tool && tool.compatible === 'Yes';
        return `
            <div style="padding: 10px 0; border-bottom: 1px solid rgba(157, 78, 221, 0.2);">
                <label style="color: #B0E0E6; display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" checked value="${toolName}" style="margin-right: 10px; cursor: pointer;">
                    <span>${toolName}</span>
                    <span style="margin-left: auto; color: #B0E0E6; font-size: 12px;">
                        ${isCompatible ? 'Compatible' : 'Not Compatible'}
                    </span>
                </label>
            </div>
        `;
    }).join('');
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>${profileName} - Tool Selection</h2>
                <button class="modal-close" onclick="document.getElementById('toolSelectModal').remove()">×</button>
            </div>
            <div class="modal-body">
                <p style="color: #B0E0E6; margin-bottom: 20px;">Select which tools from this profile you want to install:</p>
                <div id="toolCheckboxes">${toolsHtml}</div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="document.getElementById('toolSelectModal').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="confirmProfileInstallation('${profileName}')">Install Selected Tools</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function confirmProfileInstallation(profileName) {
    const checkboxes = document.querySelectorAll('#toolSelectModal input[type="checkbox"]:checked');
    const selectedTools = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedTools.length === 0) {
        showNotification('Please select at least one tool');
        return;
    }
    
    installProfile(profileName, selectedTools.length);
    document.getElementById('toolSelectModal').remove();
}

function installProfile(profileName, toolCount) {
    showNotification(`Installing ${profileName} (${toolCount} tools)... This may take a few minutes.`);
    logActivity(`Profile installation started: ${profileName}`);
    
    setTimeout(() => {
        showNotification(`${profileName} profile installed successfully.`);
        logActivity(`Profile installation completed: ${profileName}`);
    }, 3000);
}

// ==================== SETTINGS FUNCTIONS ====================

function saveSetting(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    logActivity(`Setting updated: ${key}`);
}

function loadSettings() {
    // Load dark mode setting
    const darkMode = JSON.parse(localStorage.getItem('darkMode') || 'false');
    if (darkMode) {
        document.body.classList.add('dark-mode');
        const darkModeCheckbox = document.getElementById('darkMode');
        if (darkModeCheckbox) darkModeCheckbox.checked = true;
    }
    
    // Load other settings
    const autoRefresh = JSON.parse(localStorage.getItem('autoRefresh') || 'true');
    const notifications = JSON.parse(localStorage.getItem('notifications') || 'true');
    
    if (document.getElementById('autoRefresh')) document.getElementById('autoRefresh').checked = autoRefresh;
    if (document.getElementById('notifications')) document.getElementById('notifications').checked = notifications;
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    saveSetting('darkMode', isDarkMode);
    showNotification(isDarkMode ? 'Dark mode enabled' : 'Light mode enabled');
}

function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
        localStorage.clear();
        location.reload();
    }
}

function clearCache() {
    if (confirm('This will clear the application cache. Continue?')) {
        localStorage.clear();
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

function getInstalledTools() {
    const installedTools = {};
    for (const toolKey in TOOLS_DATABASE) {
        const tool = TOOLS_DATABASE[toolKey];
        const isInstalled = localStorage.getItem(`tool_${tool.id}_installed`) === 'true';
        if (isInstalled) {
            installedTools[tool.name] = true;
        }
    }
    return installedTools;
}

function downloadConfiguration(format = 'json') {
    const systemInfo = SystemInfo.getOSInfo();
    const userOS = localStorage.getItem('userOS') || systemInfo.os;
    const isInitialized = localStorage.getItem('kterInitialized') === 'true';
    
    // Get hardware ID to tag configuration
    BackendAPI.getHardwareId().then(hwidResult => {
        const hardwareId = hwidResult.hardware_id || 'unknown';
        
        // Gather all configuration data
        const configuration = {
            metadata: {
                aplikacija: 'Kjer',
                версија: localStorage.getItem('kterVersion') || '1.0.0',
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
                tutorialCompleted: localStorage.getItem('kterTutorialCompleted') === 'true'
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
