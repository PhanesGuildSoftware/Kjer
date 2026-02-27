# =============================================================================
#  kjer-install.ps1  —  Kjer Dependency Bootstrapper for Windows
#  Run this ONCE before using Kjer for the first time.
#  Installs all runtime dependencies (Python, Node.js, Electron) and
#  wires up the 'kjer' CLI command — no prior initialization required.
#
#  Usage (from the Kjer root directory, in an elevated PowerShell):
#    powershell -ExecutionPolicy Bypass -File installer\kjer-install.ps1
#    powershell -ExecutionPolicy Bypass -File installer\kjer-install.ps1 -NoGui
#
#  Requires: Windows 10/11, PowerShell 5.1+
# =============================================================================

param(
    [switch]$NoGui   # Skip Node.js / Electron install
)

# ── Helpers ──────────────────────────────────────────────────────────────────
function Ok($msg)   { Write-Host "  $([char]0x2713) $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  -> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "  X $msg" -ForegroundColor Red }
function Hdr($msg)  { Write-Host "`n-- $msg --" -ForegroundColor Magenta }

# ── Paths ────────────────────────────────────────────────────────────────────
$ScriptDir  = $PSScriptRoot
$KjerRoot   = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$DesktopDir = Join-Path $KjerRoot "desktop"
$LibDir     = Join-Path $KjerRoot "lib"
$ScriptsDir = Join-Path $KjerRoot "scripts"
$CliScript  = Join-Path $ScriptsDir "kjer-cli.ps1"

# ── Banner ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ██╗  ██╗     ██╗███████╗██████╗ " -ForegroundColor Magenta
Write-Host "  ██║ ██╔╝     ██║██╔════╝██╔══██╗" -ForegroundColor Magenta
Write-Host "  █████╔╝      ██║█████╗  ██████╔╝" -ForegroundColor Magenta
Write-Host "  ██╔═██╗ ██   ██║██╔══╝  ██╔══██╗" -ForegroundColor Magenta
Write-Host "  ██║  ██╗╚█████╔╝███████╗██║  ██║" -ForegroundColor Magenta
Write-Host "  ╚═╝  ╚═╝ ╚════╝ ╚══════╝╚═╝  ╚═╝" -ForegroundColor Magenta
Write-Host "         Dependency Bootstrapper v1.0.0" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Elevation check ──────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Warn "Not running as Administrator."
    Warn "Some steps (PATH update, winget install) may require elevation."
    Warn "Re-run as Administrator if any step fails:"
    Write-Host "    Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File `"$PSCommandPath`"'" -ForegroundColor Yellow
    Write-Host ""
}

# ── Step 2: Python 3 ─────────────────────────────────────────────────────────
Hdr "Python 3"
$python = Get-Command python -ErrorAction SilentlyContinue
$python3 = Get-Command python3 -ErrorAction SilentlyContinue
if ($python -or $python3) {
    $pyExe = if ($python3) { "python3" } else { "python" }
    $pyVer = & $pyExe --version 2>&1
    Ok "Found: $pyVer"
} else {
    Info "Python 3 not found — installing via winget..."
    try {
        winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
        Ok "Python 3 installed."
    } catch {
        Err "Could not install Python 3 automatically."
        Info "Download from https://python.org and re-run this script."
        exit 1
    }
}

# Ensure pip / pyyaml
$pyExe = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "python" }
$yamlCheck = & $pyExe -c "import yaml; print('ok')" 2>&1
if ($yamlCheck -ne "ok") {
    Info "Installing PyYAML..."
    & $pyExe -m pip install --quiet pyyaml
    Ok "PyYAML installed."
} else {
    Ok "PyYAML already available."
}

# ── Step 3: Node.js + Electron ───────────────────────────────────────────────
if (-not $NoGui) {
    Hdr "Node.js & npm"
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) {
        Ok "Node.js $(node --version)  |  npm $(npm --version)"
    } else {
        Info "Node.js not found — installing via winget..."
        try {
            winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                        [System.Environment]::GetEnvironmentVariable('Path','User')
            $npm = Get-Command npm -ErrorAction SilentlyContinue
            if ($npm) {
                Ok "Node.js installed: $(node --version)"
            } else {
                Warn "Node.js installed but requires a new terminal to be on PATH."
                Warn "Open a new PowerShell window and re-run: installer\kjer-install.ps1"
                Read-Host "Press Enter to continue anyway..."
            }
        } catch {
            Err "Could not install Node.js automatically."
            Info "Download from https://nodejs.org and re-run this script."
        }
    }

    Hdr "Electron (GUI engine)"
    $pkgJson = Join-Path $DesktopDir "package.json"
    if (Test-Path $pkgJson) {
        $localElectronCmd = Join-Path $DesktopDir "node_modules\.bin\electron.cmd"
        $localElectron    = Join-Path $DesktopDir "node_modules\.bin\electron"
        if ((Test-Path $localElectronCmd) -or (Test-Path $localElectron)) {
            Ok "Electron already installed in desktop/node_modules"
        } else {
            Info "Running npm install in $DesktopDir ..."
            Push-Location $DesktopDir
            try {
                npm install 2>&1 | Select-Object -Last 5
                if ((Test-Path $localElectronCmd) -or (Test-Path $localElectron)) {
                    Ok "Electron installed."
                } else {
                    Warn "npm install ran — Electron binary not confirmed. Try: cd desktop && npm install"
                }
            } catch {
                Err "npm install failed: $_"
            } finally {
                Pop-Location
            }
        }
    } else {
        Warn "desktop/package.json not found — skipping Electron install."
    }
} else {
    Info "Skipping GUI/Electron install (-NoGui specified)."
}

# ── Step 4: CLI command setup ────────────────────────────────────────────────
Hdr "CLI Command  ( kjer )"
if (Test-Path $CliScript) {
    # Add Kjer scripts dir to User PATH if not already present
    $currentPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    if ($currentPath -notlike "*$ScriptsDir*") {
        Info "Adding $ScriptsDir to User PATH..."
        [System.Environment]::SetEnvironmentVariable(
            'Path',
            "$currentPath;$ScriptsDir",
            'User'
        )
        $env:Path = $env:Path + ";$ScriptsDir"
        Ok "PATH updated — 'kjer' will be available in new terminal windows."
    } else {
        Ok "$ScriptsDir already on PATH."
    }

    # Create a wrapper batch file in a directory that's already on PATH for immediate use
    $sysBin = "$env:SystemRoot\System32"
    $wrapperPath = Join-Path $sysBin "kjer.bat"
    if (-not (Test-Path $wrapperPath)) {
        if ($isAdmin) {
            $wrapperContent = "@echo off`r`npowershell -ExecutionPolicy Bypass -File `"$CliScript`" %*`r`n"
            Set-Content -Path $wrapperPath -Value $wrapperContent
            Ok "Created system wrapper: $wrapperPath"
        } else {
            Warn "Skipping system wrapper (not admin). 'kjer' will work in new terminals after PATH update."
        }
    } else {
        Ok "System wrapper already exists: $wrapperPath"
    }
} else {
    Warn "kjer-cli.ps1 not found at $CliScript"
    Warn "Ensure Kjer is fully extracted. Re-run after verifying the file exists."
}

# ── Step 5: Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "  Kjer dependencies installed successfully!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Launch the GUI to activate your license and initialize Kjer:"
Write-Host "       kjer --gui" -ForegroundColor Green
Write-Host ""
Write-Host "  2. In the GUI:"
Write-Host "       a) Enter your license key" -ForegroundColor Cyan
Write-Host "       b) Click 'Initialize'" -ForegroundColor Cyan
Write-Host "       c) Complete OS detection" -ForegroundColor Cyan
Write-Host ""
Write-Host "  3. Once initialized, the full CLI is available:"
Write-Host ""
Write-Host "       kjer                Interactive menu" -ForegroundColor Yellow
Write-Host "       kjer --status       Activation & system status" -ForegroundColor Yellow
Write-Host "       kjer --list         Browse available security tools" -ForegroundColor Yellow
Write-Host "       kjer --gui          Re-open the GUI" -ForegroundColor Yellow
Write-Host "       kjer --help         Full command reference" -ForegroundColor Yellow
Write-Host ""
Write-Host "  NOTE: Open a new PowerShell window for PATH changes to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Need a license? https://phanesguild.com/kjer" -ForegroundColor Cyan
Write-Host ""
