# Kjer Windows PowerShell CLI Setup Script
# Only runs if executed on Windows

Write-Host "[+] Kjer PowerShell CLI Setup Starting..." -ForegroundColor Cyan

# ─── Ensure Node.js / npm is available ───────────────────────────────────────
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Host "[*] Node.js not found. Installing via winget..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
        # Refresh PATH for current session
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if ($npm) {
            Write-Host "[+] Node.js installed: $(node --version)" -ForegroundColor Green
        } else {
            Write-Host "[!] Node.js installed but requires a terminal restart to be on PATH" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[-] Could not install Node.js automatically. Install from https://nodejs.org" -ForegroundColor Red
    }
} else {
    Write-Host "[+] Node.js found: $(node --version)  |  npm: $(npm --version)" -ForegroundColor Green
}

# ─── npm install in desktop/ (installs local Electron) ───────────────────────
$desktopDir = Join-Path $PSScriptRoot '..' 'desktop'
if (Test-Path (Join-Path $desktopDir 'package.json')) {
    Write-Host "[*] Running npm install in $desktopDir ..." -ForegroundColor Cyan
    Push-Location $desktopDir
    try {
        npm install 2>&1 | Select-Object -Last 3
        $localElectron = Join-Path $desktopDir 'node_modules\.bin\electron.cmd'
        if (Test-Path $localElectron) {
            Write-Host "[+] Electron installed: $localElectron" -ForegroundColor Green
        } else {
            Write-Host "[!] npm install ran — Electron binary not yet confirmed" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[!] desktop/package.json not found — skipping Electron install" -ForegroundColor Yellow
}

# ─── CLI script setup ─────────────────────────────────────────────────────────
$cliSource = Join-Path $PSScriptRoot "..\scripts\kjer-cli.ps1"
$cliTarget = "$env:ProgramFiles\Kjer\kjer.ps1"
$shortcut = "$env:ProgramFiles\Kjer\kjer.cmd"

# Ensure target directory exists
if (!(Test-Path "$env:ProgramFiles\Kjer")) {
    New-Item -ItemType Directory -Path "$env:ProgramFiles\Kjer" | Out-Null
}

# Copy CLI script (placeholder for now)
if (Test-Path $cliSource) {
    Copy-Item $cliSource $cliTarget -Force
    Write-Host "[+] Copied kjer-cli.ps1 to $cliTarget" -ForegroundColor Green
} else {
    Write-Host "[-] kjer-cli.ps1 not found at $cliSource" -ForegroundColor Red
}

# Create a .cmd launcher for easy command-line access
$cmdContent = "@echo off`npowershell -ExecutionPolicy Bypass -File `"$cliTarget`" %*"
Set-Content -Path $shortcut -Value $cmdContent -Force
Write-Host "[+] Created launcher: $shortcut" -ForegroundColor Green

# Add %ProgramFiles%\Kjer to system PATH so 'kjer' is accessible from any terminal
$kjerprogramdir = "$env:ProgramFiles\Kjer"
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($currentPath -notlike "*$kjerprogramdir*") {
    [Environment]::SetEnvironmentVariable('Path', "$currentPath;$kjerprogramdir", 'Machine')
    Write-Host "[+] Added Kjer to system PATH: $kjerprogramdir" -ForegroundColor Green
    Write-Host "[!] Restart your terminal for PATH changes to take effect" -ForegroundColor Yellow
} else {
    Write-Host "[+] Kjer already in system PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "[+] Kjer CLI setup complete." -ForegroundColor Cyan
Write-Host ""
Write-Host "    Kjer CLI commands (Windows):" -ForegroundColor Yellow
Write-Host "      kjer              Launch interactive menu"
Write-Host "      kjer --gui        Launch the Kjer GUI application"
Write-Host "      kjer --status     Show installation status"
Write-Host "      kjer --list       List available tools"
Write-Host "      kjer --version    Show version"
Write-Host "      kjer --help       Show help"
Write-Host ""
Write-Host "    Note: initialization is done exclusively through the GUI." -ForegroundColor Yellow
Write-Host ""
