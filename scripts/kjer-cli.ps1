# ============================================================
#  Kjer CLI - Windows PowerShell Edition
#  Professional Cybersecurity Tool Management Platform
#  PhanesGuild Software - v1.0.0 (windows)
# ============================================================

#Requires -Version 5.1

# ==================== PATH CONSTANTS ====================

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir
$DbPath      = Join-Path $ProjectRoot 'db\defensive-tools-db.yaml'
$BackendApi  = Join-Path $ProjectRoot 'lib\backend_api.py'
$InitFlag    = Join-Path $env:USERPROFILE '.kjer\initialized'
$KjerDir     = Join-Path $env:USERPROFILE '.kjer'

# ==================== BACKEND API ====================

function Invoke-BackendAPI {
    param(
        [string]$Action,
        [hashtable]$Params = @{}
    )

    $args = @($BackendApi, $Action)
    if ($Params.ContainsKey('tool'))          { $args += '--tool';         $args += $Params['tool'] }
    if ($Params.ContainsKey('profile'))       { $args += '--profile';      $args += $Params['profile'] }
    if ($Params.ContainsKey('licenseKey'))    { $args += '--license-key';  $args += $Params['licenseKey'] }
    if ($Params.ContainsKey('licenseType'))   { $args += '--license-type'; $args += $Params['licenseType'] }
    if ($Params.ContainsKey('detectedOS'))    { $args += '--detected-os';  $args += $Params['detectedOS'] }

    try {
        $result = & python $args 2>&1
        if ($result) {
            try {
                return $result | ConvertFrom-Json
            } catch {
                return [PSCustomObject]@{ success = $true; message = ($result -join "`n").Trim() }
            }
        }
        return [PSCustomObject]@{ success = $false; error = 'No response from backend' }
    } catch {
        return [PSCustomObject]@{ success = $false; error = $_.Exception.Message }
    }
}

function Get-ActivationStatus       { return Invoke-BackendAPI 'check-activation' }
function Get-SystemStatus           { return Invoke-BackendAPI 'system-status' }
function Get-InstalledTools         { return Invoke-BackendAPI 'list-installed' }
function Install-KjerTool($n)       { return Invoke-BackendAPI 'install'         @{ tool    = $n } }
function Uninstall-KjerTool($n)     { return Invoke-BackendAPI 'uninstall'       @{ tool    = $n } }
function Install-KjerProfile($p)    { return Invoke-BackendAPI 'install-profile' @{ profile = $p } }
function Invoke-Uninitialize        { return Invoke-BackendAPI 'uninitialize' }
function Invoke-ActivateLicense($k) { return Invoke-BackendAPI 'activate'       @{ licenseKey = $k } }
function Invoke-Reinitialize        { return Invoke-BackendAPI 'reinitialize' }

# ==================== YAML LOADER ====================

function Import-Yaml {
    param([string]$FilePath)
    # Minimal YAML parser for the defensive-tools-db.yaml structure.
    # Falls back gracefully if powershell-yaml module is available.
    try {
        if (Get-Module -ListAvailable -Name 'powershell-yaml' -ErrorAction SilentlyContinue) {
            Import-Module powershell-yaml -ErrorAction SilentlyContinue
            return ConvertFrom-Yaml (Get-Content $FilePath -Raw)
        }
    } catch {}

    # Lightweight fallback: return a marker so callers can show a useful message
    return $null
}

# ==================== OS COMPATIBILITY ====================

function Test-Initialization {
    $status = Get-ActivationStatus
    if (-not $status.activated) {
        return $false, $status
    }
    return $true, $status
}

function Test-OSCompatibility {
    $systemStatus = Get-SystemStatus
    if (-not $systemStatus.success) {
        return $false, 'unknown', 'Unable to retrieve system information from backend.'
    }

    $detectedOS = ($systemStatus.detected_os ?? '').ToLower()

    if (-not $detectedOS) {
        $osRaw = ($systemStatus.system_info?.os ?? '').ToLower()
        if ($osRaw -match 'windows|win') { $detectedOS = 'windows' }
        elseif ($osRaw -match 'ubuntu|debian|fedora|arch|linux') { $detectedOS = 'linux' }
        elseif ($osRaw -match 'mac|darwin') { $detectedOS = 'macos' }
    }

    if (-not $detectedOS -or $detectedOS -eq 'n/a') {
        return $false, 'unknown', 'OS not detected during initialization. Please re-initialize via GUI.'
    }

    if ($detectedOS -ne 'windows') {
        return $false, $detectedOS, "This is the Windows CLI. Your system was detected as $($detectedOS.ToUpper()) during initialization."
    }

    return $true, $detectedOS, 'OS compatibility verified'
}

# ==================== DISPLAY HELPERS ====================

function Get-DetectedOSLabel {
    # OS label only comes from the backend-detected OS set during GUI initialization.
    # Never uses $env:OS or [System.Environment]::OSVersion.
    try {
        $status = Get-SystemStatus
        $detected = ($status.detected_os ?? '').ToLower()
        if (-not $detected) {
            $osRaw = ($status.system_info?.os ?? '').ToLower()
            if     ($osRaw -match 'windows|win')              { $detected = 'windows' }
            elseif ($osRaw -match 'ubuntu|debian|fedora|arch|linux') { $detected = 'linux' }
            elseif ($osRaw -match 'mac|darwin')               { $detected = 'macos' }
        }
        if ($detected) { return $detected } else { return $null }
    } catch { return $null }
}

function Write-Banner {
    Clear-Host
    # OS label only from backend-initialized state
    $osLabel = Get-DetectedOSLabel
    $versionLine = if ($osLabel) { "v1.0.0 ($osLabel)" } else { 'v1.0.0' }
    Write-Host ""
    Write-Host "##  ##     ##  ######  #####  " -ForegroundColor Magenta
    Write-Host "##  ##     ##  ##      ##  ## " -ForegroundColor Magenta
    Write-Host "#####      ##  ####    #####  " -ForegroundColor Magenta
    Write-Host "##  ##  #  ##  ##      ##  ## " -ForegroundColor Magenta
    Write-Host "##  ##  ####   ######  ##  ## " -ForegroundColor Magenta
    Write-Host ""
    Write-Host ("         {0,-30}    " -f $versionLine) -ForegroundColor Cyan
    Write-Host "   Professional Cybersecurity Tool Management Platform   " -ForegroundColor Gray
    Write-Host ""
}

function Write-SystemInfo {
    $info = Get-SystemStatus
    $si   = $info.system_info

    Write-Host ("="*70) -ForegroundColor Yellow
    Write-Host "  SYSTEM INFORMATION" -ForegroundColor Yellow
    Write-Host ("="*70) -ForegroundColor Yellow

    if ($si) {
        Write-Host "  " -NoNewline; Write-Host "OS:           " -NoNewline -ForegroundColor Green; Write-Host $si.os
        Write-Host "  " -NoNewline; Write-Host "Architecture: " -NoNewline -ForegroundColor Green; Write-Host $si.arch
        Write-Host "  " -NoNewline; Write-Host "CPU Cores:    " -NoNewline -ForegroundColor Green; Write-Host $si.cpu_cores
        Write-Host "  " -NoNewline; Write-Host "Total RAM:    " -NoNewline -ForegroundColor Green; Write-Host "$($si.total_ram) MB ($($si.avail_ram) MB available)"
        Write-Host "  " -NoNewline; Write-Host "Total Disk:   " -NoNewline -ForegroundColor Green; Write-Host "$($si.total_disk) GB ($($si.avail_disk) GB available)"
    } else {
        Write-Host "  (System info unavailable)" -ForegroundColor Gray
    }

    Write-Host ("="*70) -ForegroundColor Yellow
    Write-Host ""
}

function Write-Header {
    Write-Banner
    Write-SystemInfo
}

function Write-SectionHeader($title) {
    Write-Host ""
    Write-Host ("="*70) -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("="*70) -ForegroundColor Cyan
}

function Pause-ForInput {
    Write-Host ""
    Read-Host -Prompt "Press Enter to continue"
}

# ==================== MENU FUNCTIONS ====================

function Show-ListTools($db) {
    Write-SectionHeader "AVAILABLE TOOLS"
    if (-not $db) { Write-Host "  (Tool database unavailable - install 'powershell-yaml' module)" -ForegroundColor Yellow; return }
    foreach ($cat in $db.Keys) {
        if ($cat -eq 'profiles') { continue }
        Write-Host ""
        Write-Host "[$($cat.ToUpper())]" -ForegroundColor Magenta
        foreach ($tname in $db[$cat].Keys) {
            $t = $db[$cat][$tname]
            Write-Host "  " -NoNewline
            Write-Host "* " -NoNewline -ForegroundColor Green
            Write-Host ("{0,-20} - {1}" -f $tname, ($t.description ?? 'No description'))
            Write-Host ("    Binary: {0}" -f ($t.binary ?? 'N/A')) -ForegroundColor DarkYellow
        }
    }
}

function Show-Profiles($db) {
    Write-SectionHeader "INSTALLATION PROFILES"
    if (-not $db -or -not $db.ContainsKey('profiles')) {
        Write-Host "  No profiles available." -ForegroundColor Red
        return
    }
    foreach ($pname in $db['profiles'].Keys) {
        $p = $db['profiles'][$pname]
        Write-Host ""
        Write-Host $p.name -ForegroundColor Magenta
        Write-Host "  $($p.description)"
        $toolCount = $p.tools.Count
        $toolsDisplay = ($p.tools | Select-Object -First 5) -join ', '
        if ($toolCount -gt 5) { $toolsDisplay += ", ... (+$($toolCount-5) more)" }
        Write-Host "  " -NoNewline; Write-Host "Tools ($toolCount): " -NoNewline -ForegroundColor DarkYellow; Write-Host $toolsDisplay
    }
    Write-Host ""
    $choice = Read-Host "Install a profile? Enter profile name or press Enter to return"
    if (-not $choice) { return }

    $profileKey = $null
    foreach ($pname in $db['profiles'].Keys) {
        if ($db['profiles'][$pname].name -ieq $choice) { $profileKey = $pname; break }
    }
    if ($profileKey) {
        Install-ProfileFromMenu $profileKey $db
    } else {
        Write-Host "  Profile '$choice' not found." -ForegroundColor Red
    }
}

function Install-ProfileFromMenu($profileName, $db) {
    $profile = $db['profiles'][$profileName]
    Write-Host ""
    Write-Host "-> Installing profile: $($profile.name)" -ForegroundColor Cyan
    Write-Host "   $($profile.description)"
    Write-Host "   Tools ($($profile.tools.Count)): $($profile.tools -join ', ')" -ForegroundColor DarkYellow
    Write-Host ""
    $confirm = Read-Host "Proceed with installation? (yes/no)"
    if ($confirm -ne 'yes') { Write-Host "  Profile installation cancelled." -ForegroundColor DarkYellow; return }

    $result = Install-KjerProfile $profileName
    if ($result.success) {
        Write-Host "  + Profile '$($profile.name)' installed successfully!" -ForegroundColor Green
        if ($result.tools_installed) { Write-Host "    Installed: $($result.tools_installed -join ', ')" -ForegroundColor Green }
        if ($result.tools_failed)    { Write-Host "    Failed:    $($result.tools_failed -join ', ')"    -ForegroundColor Red }
    } else {
        Write-Host "  x Profile installation failed." -ForegroundColor Red
        if ($result.error) { Write-Host "    Error: $($result.error)" }
    }
}

function Show-InstallTool($db) {
    if (-not $db) {
        Write-Host "  (Tool database unavailable)" -ForegroundColor Yellow
        return
    }
    $allTools = @{}
    foreach ($cat in $db.Keys) {
        if ($cat -eq 'profiles') { continue }
        foreach ($tname in $db[$cat].Keys) { $allTools[$tname] = $cat }
    }

    Write-Host ""
    Write-Host "Available tools:" -ForegroundColor Cyan
    foreach ($tname in ($allTools.Keys | Sort-Object)) {
        $cat  = $allTools[$tname]
        $desc = $db[$cat][$tname].description ?? ''
        Write-Host "  * " -NoNewline -ForegroundColor Green
        Write-Host ("{0,-20} - {1}" -f $tname, $desc)
    }

    Write-Host ""
    $tname = Read-Host "Enter tool name to install (or 'back' to return)"
    if ($tname -ieq 'back') { return }
    if (-not $allTools.ContainsKey($tname)) { Write-Host "  x Tool not found." -ForegroundColor Red; return }

    $cat   = $allTools[$tname]
    $tdata = $db[$cat][$tname]
    Write-Host ""
    Write-Host "-> Installing $tname..." -ForegroundColor Cyan
    Write-Host "   Category: $($cat.Substring(0,1).ToUpper()+$cat.Substring(1))"
    if ($tdata.packages) { Write-Host "   Packages: $($tdata.packages -join ', ')" }

    $result = Install-KjerTool $tname
    if ($result.success) {
        Write-Host "  + Successfully installed $tname" -ForegroundColor Green
        if ($result.message) { Write-Host "    $($result.message)" }
    } else {
        Write-Host "  x Failed to install $tname" -ForegroundColor Red
        if ($result.error)  { Write-Host "    Error: $($result.error)" }
        if ($result.stderr) { Write-Host "    $($result.stderr)" }
    }
}

function Show-InstallToolAdvanced($db) {
    Write-SectionHeader "ADVANCED TOOL INSTALLATION WITH FILTERS"
    if (-not $db) { Write-Host "  (Tool database unavailable)" -ForegroundColor Yellow; return }

    $categories = $db.Keys | Where-Object { $_ -ne 'profiles' } | Sort-Object
    Write-Host "`nAvailable categories:"
    $i = 1
    foreach ($cat in $categories) {
        Write-Host ("  {0}) {1} ({2} tools)" -f $i, ($cat.Substring(0,1).ToUpper()+$cat.Substring(1)), $db[$cat].Count) -ForegroundColor Cyan
        $i++
    }
    Write-Host "  0) All categories" -ForegroundColor Cyan

    $choice = Read-Host "`nSelect category number (or 'back' to return)"
    if ($choice -ieq 'back') { return }

    try {
        $choiceNum = [int]$choice
    } catch {
        Write-Host "  x Invalid input." -ForegroundColor Red; return
    }

    $catList = @($categories)
    if ($choiceNum -eq 0) {
        Show-ListTools $db
        $tools = Read-Host "`nEnter tool names to install (comma-separated, or 'back')"
        if ($tools -ine 'back') {
            foreach ($tname in ($tools -split ',').Trim()) {
                Write-Host "`n-> Installing $tname..." -ForegroundColor Cyan
                $result = Install-KjerTool $tname
                if ($result.success) { Write-Host "  + Installed $tname" -ForegroundColor Green }
                else                 { Write-Host "  x Failed: $tname"   -ForegroundColor Red }
            }
        }
    } elseif ($choiceNum -ge 1 -and $choiceNum -le $catList.Count) {
        $selectedCat = $catList[$choiceNum - 1]
        Write-Host "`n$($selectedCat.ToUpper()) Tools:" -ForegroundColor Magenta
        foreach ($tname in $db[$selectedCat].Keys) {
            $desc = $db[$selectedCat][$tname].description ?? ''
            Write-Host "  * " -NoNewline -ForegroundColor Green; Write-Host "$tname - $desc"
        }
        $tools = Read-Host "`nEnter tool names to install (comma-separated, or 'back')"
        if ($tools -ine 'back') {
            foreach ($tname in ($tools -split ',').Trim()) {
                if ($db[$selectedCat].ContainsKey($tname)) {
                    Write-Host "`n-> Installing $tname..." -ForegroundColor Cyan
                    $result = Install-KjerTool $tname
                    if ($result.success) { Write-Host "  + Installed $tname" -ForegroundColor Green }
                    else                 { Write-Host "  x Failed: $tname"   -ForegroundColor Red }
                } else {
                    Write-Host "  x $tname not found in $selectedCat" -ForegroundColor Red
                }
            }
        }
    } else {
        Write-Host "  x Invalid choice." -ForegroundColor Red
    }
}

function Show-UninstallTool {
    Write-Host "`n-> Fetching installed tools..." -ForegroundColor Cyan
    $result = Get-InstalledTools
    if (-not $result.success -or -not $result.tools) {
        Write-Host "  No tools currently installed." -ForegroundColor DarkYellow
        return
    }
    Write-Host "`nInstalled tools:" -ForegroundColor Green
    foreach ($t in $result.tools) { Write-Host "  * $t" -ForegroundColor Green }

    $tname = Read-Host "`nEnter tool name to uninstall (or 'back' to return)"
    if ($tname -ieq 'back') { return }
    if ($result.tools -notcontains $tname) {
        Write-Host "  x $tname is not installed." -ForegroundColor Red; return
    }
    $confirm = Read-Host "Are you sure you want to uninstall $tname? (yes/no)"
    if ($confirm -ne 'yes') { Write-Host "  Uninstall cancelled." -ForegroundColor DarkYellow; return }

    Write-Host "`n-> Uninstalling $tname..." -ForegroundColor Cyan
    $result2 = Uninstall-KjerTool $tname
    if ($result2.success) {
        Write-Host "  + Successfully uninstalled $tname" -ForegroundColor Green
    } else {
        Write-Host "  x Failed to uninstall $tname" -ForegroundColor Red
        if ($result2.error) { Write-Host "    Error: $($result2.error)" }
    }
}

function Show-Status {
    Write-SectionHeader "STATUS & INSTALLED TOOLS"

    $statusResult = Get-SystemStatus
    if ($statusResult.success -and $statusResult.status) {
        $s = $statusResult.status
        Write-Host "`nSystem Status:" -ForegroundColor Green
        Write-Host "  Package Manager: $($s.package_manager ?? 'Unknown')"
        Write-Host "  Last Update:     $($s.last_update     ?? 'Never')"
    }

    Write-Host "`n-> Fetching installed tools..." -ForegroundColor Cyan
    $toolsResult = Get-InstalledTools
    if ($toolsResult.success) {
        $installed = $toolsResult.tools
        if ($installed -and $installed.Count -gt 0) {
            Write-Host "`nInstalled Tools ($($installed.Count)):" -ForegroundColor Green
            foreach ($t in $installed) { Write-Host "  * $t" -ForegroundColor Green }
        } else {
            Write-Host "  No tools currently installed." -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "  x Error fetching installed tools" -ForegroundColor Red
        if ($toolsResult.error) { Write-Host "    $($toolsResult.error)" }
    }
}

function Show-PackageManagement {
    Write-SectionHeader "PACKAGE SOURCE MANAGEMENT (WINGET)"
    Write-Host ""
    Write-Host "  1) Update package sources  (winget source update)"          -ForegroundColor Cyan
    Write-Host "  2) Upgrade all packages    (winget upgrade --all)"          -ForegroundColor Cyan
    Write-Host "  3) List package sources    (winget source list)"            -ForegroundColor Cyan
    Write-Host "  4) Add package source"                                      -ForegroundColor Cyan
    Write-Host "  0) Back to main menu"                                       -ForegroundColor Red

    $choice = Read-Host "`nYour choice"

    switch ($choice) {
        '1' {
            Write-Host "`n-> Updating package sources..." -ForegroundColor Cyan
            try {
                winget source update
                Write-Host "  + Package sources updated." -ForegroundColor Green
            } catch {
                Write-Host "  x Error: $_" -ForegroundColor Red
            }
        }
        '2' {
            $confirm = Read-Host "This will upgrade all packages. Continue? (yes/no)"
            if ($confirm -eq 'yes') {
                Write-Host "`n-> Upgrading all packages..." -ForegroundColor Cyan
                try {
                    winget upgrade --all --accept-source-agreements --accept-package-agreements
                    Write-Host "  + All packages upgraded." -ForegroundColor Green
                } catch {
                    Write-Host "  x Error: $_" -ForegroundColor Red
                }
            } else {
                Write-Host "  Upgrade cancelled." -ForegroundColor DarkYellow
            }
        }
        '3' {
            Write-Host ""
            try {
                winget source list
            } catch {
                Write-Host "  x WinGet not available: $_" -ForegroundColor Red
            }
        }
        '4' {
            $srcName = Read-Host "Enter source name"
            $srcArg  = Read-Host "Enter source URL or identifier"
            if ($srcName -and $srcArg) {
                Write-Host "`n-> Adding source '$srcName'..." -ForegroundColor Cyan
                try {
                    winget source add --name $srcName --arg $srcArg
                    Write-Host "  + Source added." -ForegroundColor Green
                } catch {
                    Write-Host "  x Error: $_" -ForegroundColor Red
                }
            }
        }
        '0' { return }
        default { Write-Host "  x Invalid choice." -ForegroundColor Red }
    }
}

function Show-About {
    Write-SectionHeader "ABOUT KJER"
    Write-Host ""
    Write-Host "Kjer" -NoNewline -ForegroundColor Magenta
    Write-Host " - Professional Cybersecurity Tool Management Platform"
    Write-Host "Version:    " -NoNewline -ForegroundColor Green; Write-Host "1.0.0"
    Write-Host "Framework:  " -NoNewline -ForegroundColor Green; Write-Host "Defensive Security Framework"
    Write-Host "Author:     " -NoNewline -ForegroundColor Green; Write-Host "PhanesGuild Software"
    Write-Host ""
    Write-Host "A comprehensive tool installer supporting multiple platforms"
    Write-Host "with hardware-bound licensing and anti-piracy protection."
    Write-Host ""
    Write-Host "Supported Package Managers: " -NoNewline -ForegroundColor Yellow; Write-Host "WinGet, Chocolatey, Scoop"
    Write-Host "Supported Platforms:        " -NoNewline -ForegroundColor Yellow; Write-Host "Windows 10/11"
    Write-Host ""
    Write-Host "For more information, visit the documentation." -ForegroundColor Cyan
}

function Invoke-UpgradeKjer {
    Write-Host ""
    Write-Host ("="*70) -ForegroundColor Cyan
    Write-Host "  UPGRADE KJER"  -ForegroundColor Cyan
    Write-Host ("="*70) -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Enter your new license key to upgrade Kjer."
    Write-Host "  Keys are 24 characters in the format: XXXX-XXXX-XXXX-XXXX-XXXX"
    Write-Host ""
    Write-Host "  Press Enter without a key to cancel." -ForegroundColor DarkYellow
    Write-Host ""

    $raw = (Read-Host "License Key").Trim().ToUpper()
    if (-not $raw) {
        Write-Host "  Upgrade cancelled." -ForegroundColor DarkYellow
        return
    }

    # Basic format validation
    $keyStripped = $raw -replace '-', ''
    if ($keyStripped.Length -ne 20 -or $keyStripped -notmatch '^[A-Z0-9]+$') {
        Write-Host "`n  x Invalid license key format." -ForegroundColor Red
        Write-Host "    Expected format: XXXX-XXXX-XXXX-XXXX-XXXX"
        return
    }

    Write-Host ""
    Write-Host "  -> Validating license key..." -ForegroundColor Cyan

    # Get current version
    try {
        $sysStatus      = Get-SystemStatus
        $currentVersion = ($sysStatus.version ?? $sysStatus.license_version ?? '1.0.0')
    } catch { $currentVersion = '1.0.0' }

    $result = Invoke-ActivateLicense $raw

    if (-not $result.success) {
        Write-Host "`n  x License validation failed." -ForegroundColor Red
        $err = $result.message ?? $result.error ?? 'Unknown error'
        Write-Host "    $err"
        return
    }

    $newVersion = $result.license_version ?? $result.version ?? $null

    if ($newVersion -and $newVersion -ne $currentVersion) {
        # Version upgrade detected
        Write-Host "`n  + v$newVersion license activated!" -ForegroundColor Green
        Write-Host ""
        Write-Host ("-"*70) -ForegroundColor Yellow
        Write-Host "  A reinitialization is required to upgrade your Kjer system"
        Write-Host "  from " -NoNewline
        Write-Host "v$currentVersion" -NoNewline -ForegroundColor Yellow
        Write-Host " to " -NoNewline
        Write-Host "v$newVersion" -ForegroundColor Green
        Write-Host ("-"*70) -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  This will update all system components, tool definitions,"
        Write-Host "  and unlock features included with your new license tier."
        Write-Host "  Your installed tools and settings will be preserved."
        Write-Host ""

        $confirm = (Read-Host "Reinitialize now? (yes/no)").Trim().ToLower()
        if ($confirm -ne 'yes') {
            Write-Host ""
            Write-Host "  Skipped. Your v$newVersion license is active." -ForegroundColor DarkYellow
            Write-Host "  Run 'kjer --upgrade' or use menu option 9 at any time to reinitialize."
            return
        }

        Write-Host ""
        Write-Host "  -> Reinitializing Kjer..." -ForegroundColor Cyan
        $reinitResult = Invoke-Reinitialize

        if ($reinitResult.success) {
            Write-Host "`n  + Kjer has been upgraded to v$newVersion and reinitialized successfully." -ForegroundColor Green
        } else {
            Write-Host "`n  ! License activated but reinitialization encountered an issue." -ForegroundColor Yellow
            $err = $reinitResult.error ?? $reinitResult.message ?? ''
            if ($err) { Write-Host "    $err" }
            Write-Host "  You can try reinitializing from the GUI if the issue persists."
        }
    } else {
        # Same version or no version — key renewal / reactivation
        Write-Host "`n  + License reactivated successfully." -ForegroundColor Green
        if ($result.message) { Write-Host "    $($result.message)" }
    }
}

function Invoke-UnInitializeKjer {
    Write-Host ""
    Write-Host ("="*70) -ForegroundColor Red
    Write-Host "  WARNING  UNINITIALIZE KJER"             -ForegroundColor Red
    Write-Host ("="*70) -ForegroundColor Red
    Write-Host ""
    Write-Host "This will reset Kjer to its uninitialized state." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  -> Initialization data will be cleared"
    Write-Host "  -> OS detection profile will be removed"
    Write-Host "  -> Session and cache state will be reset"
    Write-Host ""
    Write-Host ("-"*70) -ForegroundColor Red
    Write-Host "  WARNING  LICENSE & VERSION WARNING"         -ForegroundColor Red
    Write-Host ("-"*70) -ForegroundColor Red
    Write-Host ""
    Write-Host "  v1.0.0:   " -NoNewline -ForegroundColor Yellow
    Write-Host "Your license key remains bound to this hardware."
    Write-Host "            You can re-initialize using your existing key."
    Write-Host ""
    Write-Host "  v1.1.0+:  " -NoNewline -ForegroundColor Red
    Write-Host "Re-initialization requires a " -NoNewline
    Write-Host "NEW license key." -ForegroundColor Yellow
    Write-Host "            Your current key will NOT be valid after uninitializing." -ForegroundColor Red
    Write-Host ""

    $confirm1 = Read-Host "Are you sure you want to uninitialize Kjer? (yes/no)"
    if ($confirm1 -ne 'yes') {
        Write-Host "  Uninitialize cancelled." -ForegroundColor DarkYellow
        return
    }

    Write-Host ""
    $confirm2 = Read-Host "Type 'UNINITIALIZE' to confirm"
    if ($confirm2 -cne 'UNINITIALIZE') {
        Write-Host "  Uninitialize cancelled." -ForegroundColor DarkYellow
        return
    }

    Write-Host "`n-> Uninitializing Kjer..." -ForegroundColor Cyan

    # Clear local state files
    try {
        if (Test-Path $InitFlag) { Remove-Item $InitFlag -Force }
        $cacheDir = Join-Path $KjerDir 'cache'
        if (Test-Path $cacheDir) {
            Get-ChildItem $cacheDir -Recurse | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
        }
    } catch {}

    # Call backend to wipe initialization and activation state
    $result = Invoke-Uninitialize

    if ($result.success) {
        Write-Host "  + Kjer has been uninitialized successfully." -ForegroundColor Green
    } else {
        Write-Host "  ! Local state cleared." -ForegroundColor Yellow
        if ($result.error) { Write-Host "    Backend note: $($result.error)" }
    }

    Write-Host ""
    Write-Host "To use Kjer again:" -ForegroundColor Cyan
    Write-Host "  1. Launch the Kjer GUI application"
    Write-Host "  2. Activate your license key"
    Write-Host "     " -NoNewline; Write-Host "-> v1.0.0: use your existing key" -ForegroundColor Cyan
    Write-Host "     " -NoNewline; Write-Host "-> v1.1.0+: you will need a NEW license key" -ForegroundColor Red
    Write-Host "  3. Click 'Initialize' to set up your system"
    Write-Host ""
    Read-Host -Prompt "Press Enter to exit"
    exit 0
}

function Invoke-UninstallKjer {
    Write-Host ""
    Write-Host ("="*70) -ForegroundColor Red
    Write-Host "  UNINSTALL KJER"  -ForegroundColor Red
    Write-Host ("="*70) -ForegroundColor Red
    Write-Host ""
    Write-Host "This will remove Kjer's system integration and state:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  -> CLI launcher       (%ProgramFiles%\Kjer\kjer.cmd / kjer.ps1)"
    Write-Host "  -> State directory    (%USERPROFILE%\.kjer\\ / ~/.kjer/)"
    Write-Host "  -> Activation data    (license and initialization state)"
    Write-Host "  -> PATH entry         (if added by installer)"
    Write-Host ""
    Write-Host "Note: " -NoNewline -ForegroundColor Cyan
    Write-Host "The Kjer directory itself is NOT removed."
    Write-Host "       Delete the Kjer folder manually for a complete removal."
    Write-Host ""

    $confirm = Read-Host "Uninstall Kjer? (yes/no)"
    if ($confirm -ne 'yes') {
        Write-Host "  Uninstall cancelled." -ForegroundColor DarkYellow
        return
    }

    Write-Host ""
    Write-Host "-> Removing Kjer system integration..." -ForegroundColor Cyan
    Write-Host ""
    $errors = @()

    # 1. Remove CLI launcher files from %ProgramFiles%\Kjer
    $kjerprogramdir = "$env:ProgramFiles\Kjer"
    foreach ($f in @("$kjerprogramdir\kjer.cmd", "$kjerprogramdir\kjer.ps1")) {
        if (Test-Path $f) {
            try {
                Remove-Item $f -Force
                Write-Host "  + Removed CLI launcher:  $f" -ForegroundColor Green
            } catch {
                $errors += "Could not remove ${f}: $_"
            }
        }
    }
    if (Test-Path $kjerprogramdir) {
        $remaining = (Get-ChildItem $kjerprogramdir -ErrorAction SilentlyContinue).Count
        if ($remaining -eq 0) {
            Remove-Item $kjerprogramdir -Force -Recurse -ErrorAction SilentlyContinue
        }
    }

    # 2. Remove from PATH (user and machine)
    try {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -like "*$kjerprogramdir*") {
            $newPath = ($userPath -split ';' | Where-Object { $_ -ne $kjerprogramdir }) -join ';'
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            Write-Host "  + Removed from user PATH"  -ForegroundColor Green
        }
        $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        if ($machinePath -like "*$kjerprogramdir*") {
            $newPath = ($machinePath -split ';' | Where-Object { $_ -ne $kjerprogramdir }) -join ';'
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
            Write-Host "  + Removed from system PATH" -ForegroundColor Green
        }
    } catch {
        $errors += "Could not update PATH: $_"
    }

    # 3. Remove %USERPROFILE%\.kjer\ state directory
    $kjerstateDir = "$env:USERPROFILE\.kjer"
    if (Test-Path $kjerstateDir) {
        try {
            Remove-Item $kjerstateDir -Recurse -Force
            Write-Host "  + Removed state dir:     $kjerstateDir" -ForegroundColor Green
        } catch {
            $errors += "Could not remove ${kjerstateDir}: $_"
        }
    } else {
        Write-Host "  ! State directory not found (already clean)" -ForegroundColor DarkYellow
    }

    # 4. Clear backend activation / initialization state
    Write-Host ""
    Write-Host "-> Wiping backend activation data..." -ForegroundColor Cyan
    $result = Invoke-Uninitialize
    if ($result.success) {
        Write-Host "  + Backend activation data cleared"  -ForegroundColor Green
    } else {
        Write-Host "  ! Backend: data may already be absent"  -ForegroundColor DarkYellow
    }

    # Summary
    Write-Host ""
    if ($errors.Count -gt 0) {
        Write-Host "--- Warnings ---" -ForegroundColor Yellow
        foreach ($e in $errors) { Write-Host "  ! $e" -ForegroundColor Yellow }
        Write-Host ""
    }
    Write-Host "  + Kjer has been uninstalled." -ForegroundColor Green
    Write-Host ""
    Write-Host "To reinstall:" -ForegroundColor Cyan
    Write-Host "  Windows (PS Admin):  .\installer\install-windows.ps1"
    Write-Host "  Linux:               sudo ./installer/install-linux.sh"
    Write-Host "  macOS:               sudo ./installer/install-desktop-mac.sh"
    Write-Host ""
    Read-Host -Prompt "Press Enter to exit"
    exit 0
}

# ==================== MAIN MENU ====================

function Show-MainMenu {
    # Check initialization
    $initialized, $initStatus = Test-Initialization
    if (-not $initialized) {
        Write-Host ""
        Write-Host ("="*70) -ForegroundColor Red
        Write-Host "  WARNING  KJER NOT INITIALIZED"  -ForegroundColor Red
        Write-Host ("="*70) -ForegroundColor Red
        Write-Host ""
        Write-Host "Kjer CLI requires initialization via the main GUI." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please launch the Kjer GUI application and complete:"
        Write-Host "  1. Activate your license key"           -ForegroundColor Cyan
        Write-Host "  2. Click the 'Initialize' button"       -ForegroundColor Cyan
        Write-Host "  3. Complete OS detection and screening"  -ForegroundColor Cyan
        Write-Host ""
        Write-Host "The CLI will be available after initialization is complete." -ForegroundColor Red
        Write-Host ""
        if ($initStatus.error) { Write-Host "Error: $($initStatus.error)" -ForegroundColor DarkGray }
        Write-Host ("="*70) -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }

    # Check OS compatibility
    $osOk, $detectedOS, $osMsg = Test-OSCompatibility
    if (-not $osOk) {
        Write-Host ""
        Write-Host ("="*70) -ForegroundColor Red
        Write-Host "  WARNING  INCORRECT CLI VERSION"  -ForegroundColor Red
        Write-Host ("="*70) -ForegroundColor Red
        Write-Host ""
        Write-Host $osMsg -ForegroundColor Yellow
        Write-Host "`nPlease use the correct CLI version for your system:"
        switch ($detectedOS) {
            'linux'  { Write-Host "  -> Use Linux CLI:  ./scripts/kjer-cli.py"  -ForegroundColor Green }
            'macos'  { Write-Host "  -> Use macOS CLI:  ./scripts/kjer-cli.py"  -ForegroundColor Green }
            default  { Write-Host "  -> Re-initialize via the GUI to re-detect your OS." }
        }
        Write-Host ""
        Write-Host ("="*70) -ForegroundColor Yellow
        exit 1
    }

    $db = Import-Yaml $DbPath

    while ($true) {
        Write-Header

        Write-Host ("="*70) -ForegroundColor Yellow
        Write-Host "  MAIN MENU" -ForegroundColor Yellow
        Write-Host ("="*70) -ForegroundColor Yellow
        Write-Host "  1) List Tools"                                      -ForegroundColor Cyan
        Write-Host "  2) Install Tools"                                   -ForegroundColor Cyan
        Write-Host "  3) Install Tools with Filters (Advanced)"           -ForegroundColor Cyan
        Write-Host "  4) Uninstall Tools"                                 -ForegroundColor Cyan
        Write-Host "  5) Status & Installed Tools"                        -ForegroundColor Cyan
        Write-Host "  6) Package Source Management (WinGet)"              -ForegroundColor Cyan
        Write-Host "  7) About Kjer"                                      -ForegroundColor Cyan
        Write-Host "  8) Uninitialize Kjer"                               -ForegroundColor Red
        Write-Host "  9) Upgrade Kjer (Enter License Key)"                -ForegroundColor Cyan
        Write-Host "  0) Exit"                                            -ForegroundColor Red
        Write-Host ("="*70) -ForegroundColor Yellow

        $choice = Read-Host "`nYour choice"

        switch ($choice) {
            '1' { Show-ListTools $db }
            '2' { Show-InstallTool $db }
            '3' { Show-InstallToolAdvanced $db }
            '4' { Show-UninstallTool }
            '5' { Show-Status }
            '6' { Show-PackageManagement }
            '7' { Show-About }
            '8' { Invoke-UnInitializeKjer }
            '9' { Invoke-UpgradeKjer }
            '0' {
                Write-Host "`n  + Exiting Kjer CLI. Goodbye!" -ForegroundColor Green
                Write-Host ""
                exit 0
            }
            default {
                Write-Host "`n  x Invalid option. Please select 0-9." -ForegroundColor Red
            }
        }

        Pause-ForInput
    }
}

# ==================== STANDALONE COMMAND HELPERS ====================

function Get-ElectronBin {
    # Returns path to an electron binary or $null. Auto-installs if needed.
    # Priority: 1) desktop/node_modules/.bin/electron  2) global electron
    #           3) npm install in desktop/  4) install Node via winget then retry
    $desktopDir   = Join-Path $ProjectRoot 'desktop'
    $localElectron = Join-Path $desktopDir 'node_modules\.bin\electron.cmd'
    if (-not (Test-Path $localElectron)) {
        $localElectron = Join-Path $desktopDir 'node_modules\.bin\electron'
    }
    if (Test-Path $localElectron) { return $localElectron }

    # Global electron on PATH
    $globalElectron = Get-Command electron -ErrorAction SilentlyContinue
    if ($globalElectron) { return $globalElectron.Source }

    # Try to install via npm
    Write-Host "  -> Electron not found. Installing automatically..." -ForegroundColor Yellow
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Host "  -> Node.js not found. Installing via winget..." -ForegroundColor Cyan
        try {
            winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
            # Refresh PATH for current session
            $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                        [System.Environment]::GetEnvironmentVariable('Path','User')
            $npm = Get-Command npm -ErrorAction SilentlyContinue
        } catch {}
        if (-not $npm) {
            Write-Host "  x npm still not available. Restart your terminal after Node.js installs." -ForegroundColor Red
            Write-Host "    Or install manually: https://nodejs.org" -ForegroundColor DarkGray
            return $null
        }
        Write-Host "  + Node.js installed via winget" -ForegroundColor Green
    }

    # npm install in desktop/
    Write-Host "  -> Running: npm install (in $desktopDir)" -ForegroundColor Cyan
    Push-Location $desktopDir
    try {
        npm install 2>&1 | Out-Null
    } finally {
        Pop-Location
    }
    if (Test-Path $localElectron) {
        Write-Host "  + Electron installed successfully" -ForegroundColor Green
        return $localElectron
    }
    Write-Host "  x Electron install failed." -ForegroundColor Red
    return $null
}

function Launch-GUI {
    $desktopDir = Join-Path $ProjectRoot 'desktop'

    # Prefer the dedicated PS1 launcher
    $guiScript = Join-Path $ScriptDir 'kjer-gui.ps1'
    if (Test-Path $guiScript) {
        Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$guiScript`""
        Write-Host "  -> Launching Kjer GUI..." -ForegroundColor Green
        return
    }

    # Check for distributed .app / installed Electron
    $electronBin = Get-ElectronBin
    if ($electronBin -and (Test-Path $desktopDir)) {
        Start-Process $electronBin -ArgumentList $desktopDir
        Write-Host "  -> Launching Kjer GUI..." -ForegroundColor Green
        return
    }

    Write-Host "  x Could not launch GUI." -ForegroundColor Red
    Write-Host "    Run manually: cd '$desktopDir'; npm install; npx electron ."
    exit 1
}

function Show-Help {
    Write-Host ""
    Write-Host "Usage:  kjer [OPTION]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  (none)              Launch interactive menu"
    Write-Host "  " -NoNewline; Write-Host "--gui,     -g       " -NoNewline -ForegroundColor Green; Write-Host "Launch the Kjer GUI application"
    Write-Host "  " -NoNewline; Write-Host "--status,  -s       " -NoNewline -ForegroundColor Green; Write-Host "Show installation status"
    Write-Host "  " -NoNewline; Write-Host "--list,    -l       " -NoNewline -ForegroundColor Green; Write-Host "List available tools"
    Write-Host "  " -NoNewline; Write-Host "--upgrade,  -u      " -NoNewline -ForegroundColor Green; Write-Host "Upgrade Kjer with a new license key"
    Write-Host "  " -NoNewline; Write-Host "--uninstall         " -NoNewline -ForegroundColor Green; Write-Host "Remove Kjer CLI integration from this system"
    Write-Host "  " -NoNewline; Write-Host "--version,  -v      " -NoNewline -ForegroundColor Green; Write-Host "Show version information"
    Write-Host "  " -NoNewline; Write-Host "--help,    -h       " -NoNewline -ForegroundColor Green; Write-Host "Show this help message"
    Write-Host ""
    Write-Host "Notes:" -ForegroundColor Yellow
    Write-Host "  Initialization is performed exclusively through the Kjer GUI."
    Write-Host "  Use 'kjer --gui' to launch the GUI and complete initialization."
    Write-Host ""
}

function Show-Version {
    # OS label only shown if backend has a stored detected_os from initialization
    $osLabel = Get-DetectedOSLabel
    $platformTag = if ($osLabel) { " ($osLabel)" } else { '' }
    Write-Host ""
    Write-Host "  " -NoNewline; Write-Host "Kjer" -NoNewline -ForegroundColor Magenta; Write-Host " v1.0.0$platformTag"
    Write-Host "  Professional Cybersecurity Tool Management Platform"
    Write-Host "  PhanesGuild Software"
    Write-Host ""
}

function Test-RequireReady {
    $initialized, $initStatus = Test-Initialization
    if (-not $initialized) {
        Write-Host "`n  x Kjer is not initialized." -ForegroundColor Red
        Write-Host "    Launch the Kjer GUI to activate and initialize first."
        if ($initStatus.error) { Write-Host "    Error: $($initStatus.error)" -ForegroundColor DarkGray }
        exit 1
    }
    $osOk, $detectedOS, $osMsg = Test-OSCompatibility
    if (-not $osOk) {
        Write-Host "`n  x $osMsg" -ForegroundColor Red
        switch ($detectedOS) {
            'linux' { Write-Host "    -> Use Linux CLI: ./scripts/kjer-cli.py" -ForegroundColor Green }
            'macos' { Write-Host "    -> Use macOS CLI: ./scripts/kjer-cli.py" -ForegroundColor Green }
            default { Write-Host "    -> Re-initialize via the GUI to re-detect your OS." }
        }
        exit 1
    }
    return $true
}

# ==================== ENTRY POINT ====================

try {
    $cmd = if ($args.Count -gt 0) { $args[0].ToLower() } else { '' }

    switch ($cmd) {
        '' {
            # No args — interactive menu
            Show-MainMenu
        }
        { $_ -in '--help', '-h' } {
            Show-Help
            exit 0
        }
        { $_ -in '--version', '-v' } {
            Show-Version
            exit 0
        }
        { $_ -in '--gui', '-g' } {
            # GUI never requires prior initialization — it IS how you initialize
            Launch-GUI
            exit 0
        }
        { $_ -in '--status', '-s' } {
            Test-RequireReady | Out-Null
            Write-Header
            Show-Status
            Write-Host ""
            exit 0
        }
        { $_ -in '--list', '-l' } {
            Test-RequireReady | Out-Null
            $db = Import-Yaml $DbPath
            Show-ListTools $db
            Write-Host ""
            exit 0
        }
        { $_ -in '--upgrade', '-u' } {
            Test-RequireReady | Out-Null
            Invoke-UpgradeKjer
            Write-Host ""
            exit 0
        }
        '--uninstall' {
            Invoke-UninstallKjer
            exit 0
        }
        # ── SECRET ── not shown in --help ──────────────────────────────
        '--uninitialize' {
            Invoke-UnInitializeKjer
        }
        # ───────────────────────────────────────────────────────────────
        default {
            Write-Host "`n  x Unknown command: $($args[0])" -ForegroundColor Red
            Write-Host "    Run 'kjer --help' for available commands."
            exit 1
        }
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    # Ctrl+C
    Write-Host "`n`n  x Interrupted by user. Exiting...`n" -ForegroundColor Red
    exit 0
} catch {
    Write-Host "`n  x Error: $($_.Exception.Message)`n" -ForegroundColor Red
    exit 1
}
