# Kjer Uninstaller for Windows
# Removes Kjer files, desktop shortcuts, and optionally dependencies.

$AppName = "Kjer"
$InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

$confirm = Read-Host "Are you sure you want to uninstall $AppName from $InstallDir? (y/N)"
if ($confirm -notmatch '^[Yy]$') {
    Write-Host "Uninstall cancelled."
    exit
}

# Remove desktop shortcut
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "$AppName.lnk"
if (Test-Path $shortcut) {
    Remove-Item $shortcut
    Write-Host "Removed desktop shortcut."
}

# Remove Start Menu shortcut
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$startShortcut = Join-Path $startMenu "$AppName.lnk"
if (Test-Path $startShortcut) {
    Remove-Item $startShortcut
    Write-Host "Removed Start Menu shortcut."
}

# Remove CLI launcher files from %ProgramFiles%\Kjer
$kjerprogramdir = "$env:ProgramFiles\Kjer"
foreach ($f in @("$kjerprogramdir\kjer.cmd", "$kjerprogramdir\kjer.ps1", "$kjerprogramdir\kjer-cli.ps1")) {
    if (Test-Path $f) { Remove-Item $f -Force; Write-Host "Removed: $f" }
}
if (Test-Path $kjerprogramdir) {
    $remaining = (Get-ChildItem $kjerprogramdir -ErrorAction SilentlyContinue).Count
    if ($remaining -eq 0) { Remove-Item $kjerprogramdir -Recurse -Force -ErrorAction SilentlyContinue }
}

# Remove Kjer from system and user PATH
try {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -like "*$kjerprogramdir*") {
        $newPath = ($userPath -split ';' | Where-Object { $_ -ne $kjerprogramdir }) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Host "Removed Kjer from user PATH."
    }
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if ($machinePath -like "*$kjerprogramdir*") {
        $newPath = ($machinePath -split ';' | Where-Object { $_ -ne $kjerprogramdir }) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
        Write-Host "Removed Kjer from system PATH."
    }
} catch {
    Write-Host "Note: Could not update PATH (may need to be run as Administrator)."
}

# Remove %USERPROFILE%\.kjer\ state directory (initialization and activation data)
$kjerstateDir = "$env:USERPROFILE\.kjer"
if (Test-Path $kjerstateDir) {
    Remove-Item $kjerstateDir -Recurse -Force
    Write-Host "Removed state directory: $kjerstateDir"
}

# Remove main install directory

# Prompt for admin if not running as admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "This script must be run as administrator. Please right-click and select 'Run as administrator'." -ForegroundColor Red
    exit 1
}

$confirmDir = Read-Host "Remove all Kjer files in $InstallDir? (y/N)"
if ($confirmDir -match '^[Yy]$') {
    Set-Location (Split-Path $InstallDir -Parent)
    Remove-Item $AppName -Recurse -Force
    Write-Host "Removed $AppName directory."
}

Write-Host "$AppName has been uninstalled."
