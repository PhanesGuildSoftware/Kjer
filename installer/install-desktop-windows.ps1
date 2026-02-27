# Automated installer for Kjer Electron desktop wrapper on Windows
Write-Host "[*] Installing Node.js dependencies for Kjer Desktop (Windows)..." -ForegroundColor Cyan
Set-Location "$PSScriptRoot\..\desktop"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[-] npm (Node.js) is required. Please install Node.js first." -ForegroundColor Red
    exit 1
}
npm install
Write-Host "[+] Node.js dependencies installed." -ForegroundColor Green

Write-Host "[*] Creating Windows desktop shortcut..." -ForegroundColor Cyan
$electronPath = (Get-Command npx).Source
$shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Kjer.lnk"
$targetPath = "$electronPath"
$arguments = 'electron .'
$workingDir = (Get-Location).Path
$iconPath = "$workingDir\icon.ico"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $workingDir
$shortcut.IconLocation = $iconPath
$shortcut.Save()

Write-Host "[+] Kjer Desktop app shortcut created! Launch it from your Start Menu." -ForegroundColor Green
