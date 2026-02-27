# Kjer GUI Launcher for Windows (PowerShell)
# Launches the Electron-based GUI application

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Join-Path $ScriptDir "..\desktop"
$KjerRoot = Split-Path -Parent $ScriptDir

# Check if Electron is installed
$electronPath = Get-Command electron -ErrorAction SilentlyContinue

if (-not $electronPath) {
    Write-Host "Error: Electron is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Electron with:"
    Write-Host "  npm install -g electron" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or install Node.js and run:"
    Write-Host "  cd $DesktopDir"
    Write-Host "  npm install" -ForegroundColor Cyan
    exit 1
}

# Check if desktop directory exists
if (-not (Test-Path $DesktopDir)) {
    Write-Host "Error: Kjer desktop directory not found at $DesktopDir" -ForegroundColor Red
    exit 1
}

# Launch Electron GUI
Write-Host "Launching Kjer GUI..." -ForegroundColor Green
Set-Location $DesktopDir
& electron . $args
