# Kjer — Professional Cybersecurity Tool Management Platform

**Version 1.1** · PhanesGuild Software · [https://phanesguild.com/kjer](https://phanesguild.com/kjer)

> **GitHub:** [PhanesGuildSoftware/Kjer](https://github.com/PhanesGuildSoftware/Kjer)  
> **Updates:** [PhanesGuildSoftware/Kjer-upgrades](https://github.com/PhanesGuildSoftware/Kjer-upgrades)

---

## ⚡ First-Time Setup (Start Here)

Kjer uses a two-step setup: **install dependencies first**, then **activate & initialize through the GUI**.  
This separation means the GUI can open even before a license is entered.

---

### 🐧 Linux

```bash
# 1. Bootstrap all dependencies (Node.js, Electron, Python libs)
bash installer/kjer-install.sh

# 2. Launch the GUI — activate your license and click Initialize
kjer --gui

# 3. Done — CLI is now fully available
kjer
```

### 🍎 macOS

```bash
# 1. Bootstrap all dependencies (installs Homebrew + Node.js if needed)
bash installer/kjer-install.sh

# 2. Launch the GUI — activate your license and click Initialize
kjer --gui

# 3. Done — CLI is now fully available
kjer
```

### 🪟 Windows (PowerShell — run as Administrator)

```powershell
# 1. Bootstrap all dependencies (installs Node.js via winget if needed)
powershell -ExecutionPolicy Bypass -File installer\kjer-install.ps1

# 2. Open a NEW PowerShell window (to pick up PATH changes), then:
kjer --gui

# 3. Done — CLI is now fully available
kjer
```

> **Why two steps?**  
> The GUI requires Electron (a Node.js app). `kjer-install` installs it once via `npm`,  
> then `kjer --gui` works every time — no internet required after the first run.

---

## 📋 CLI Command Reference

### All Platforms

| Command | Description |
|---------|-------------|
| `kjer` | Launch interactive menu (requires initialization) |
| `kjer --gui` | Open the GUI (works before initialization) |
| `kjer --install` | Run the dependency bootstrapper |
| `kjer --status` | Activation & system status |
| `kjer --list` | Browse available security tools |
| `kjer --upgrade` | Upgrade with a new license key |
| `kjer --version` | Show version |
| `kjer --uninstall` | Remove Kjer CLI from this system |
| `kjer --help` | Full help with OS-specific examples |

### 🐧 Linux — Full Workflow

```bash
# First-time dependency install
bash installer/kjer-install.sh

# Initialize via GUI
kjer --gui

# Check everything is working
kjer --status

# Browse and install security tools
kjer --list
kjer                          # opens interactive menu

# Change tier or renew your license
kjer --upgrade
```

### 🍎 macOS — Full Workflow

```bash
# First-time dependency install (installs Homebrew + Node if needed)
bash installer/kjer-install.sh

# Initialize via GUI (or double-click Kjer.app if installed)
kjer --gui

# Check status and browse tools
kjer --status
kjer --list
```

### 🪟 Windows — Full Workflow

```powershell
# As Administrator, first-time dependency install
powershell -ExecutionPolicy Bypass -File installer\kjer-install.ps1

# Open a new terminal so PATH applies, then initialize via GUI
kjer --gui

# Check status and browse tools
kjer --status
kjer --list
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔑 **Hardware-Bound Licensing** | Each license locks to one machine; prevents unauthorized copies |
| 🎟️ **Promo / Trial Licenses** | Time-limited promo keys (7-day & 30-day) — one per device via HWID enforcement; designed for public distribution (e.g. YouTube) |
| 📦 **Real Installations** | Uses apt / dnf / pacman / zypper / winget — no simulations |
| 🖥️ **Professional GUI** | Dark theme, Electron-based, OS-adaptive tool display |
| 💻 **Full CLI** | Complete command-line interface for power users |
| 🧩 **Profile-Based** | Install entire security suites with one command — tier-limited |
| 🔍 **Smart OS Detection** | Auto-detects distro and selects compatible tools |
| 🌐 **Multi-Method Network Scan** | Discovers LAN hosts via ARP cache (`/proc/net/arp` + `ip neigh`), `arp-scan`, and `nmap -sn` — finds devices even when ICMP is blocked |
| 🔬 **Rich Device Scan** | Per-device `nmap -sV -O` scan with script engine; surfaces OS, MAC, vendor, latency, uptime, open ports, service versions, and HTTP/SSL/SMB script output |
| ☑️ **Bulk Scan & Defend** | Select any combination of devices (or all) and run scans or open defence consoles in one action; results show per-device expanded rows with live updates |
| 📋 **Combined Scan Results** | Bulk scan opens a single modal that itemises every device — hostname, OS accuracy, MAC/vendor, latency, per-port table — rows expand live as each scan completes |
| 🗃️ **Enriched Device Cards** | Cards display vendor, hostname (when different from name), latency, open port count, and top 3 service tags after any scan |
| 🔗 **Peer Approval System** | Device connection requests require owner approval — no silent access |
| 🏷️ **Four License Tiers** | Personal, Home, Enterprise, and Industrial — hardware-bound, purchased via Stripe |
| 🔄 **Auto-Update Check** | Checks GitHub Releases for newer versions on startup |
| 🔎 **7-Phase Smart Scan** | Network · Vulnerability · Malware · File Integrity · Memory Forensics · Compliance · SIEM |
| 🛡️ **7-Phase Smart Defense** | Real hardening commands: scanner service restore, firewall + IP blocking + session kill, IPS, AV, access control, file integrity, audit |
| 🚀 **Run Button (Scan + Defend)** | Single-click executes the full scan then immediately applies defense — no manual chaining required |
| 📊 **Report Wizard** | Export scan + defense results as HTML, Markdown, JSON, or plain text — available any time, mid-session or post-scan |
| 👁️ **Monitor Checkbox** | Check before clicking Run to keep Kjer polling continuously every 5 minutes after the initial scan+defend cycle completes |
| 🔁 **Monitor Mode Engine** | 5-min sequential tool polling; silent unless a finding level changes; auto-defends every new/escalated threat in-line with scan output |
| 📋 **Monitor Activity Summary in Reports** | Reports include a dedicated Monitor section — total events, threat vs auto-defend breakdown, full chronological event list |
| 💾 **Persistent Activity Log** | Full session log of all scan, defense, and monitor events accumulates without clearing until Kjer is closed; persists across restarts via localStorage |
| 📝 **Rich Finding Detail** | Every finding includes file paths, check names, or specific rule violations — not just counts |
| 🔌 **Attacker IP Extraction** | On defend, Kjer parses Suricata fast.log / eve.json and Zeek conn.log for source IPs and blocks them via iptables |
| 🛑 **Active Session Termination** | Attacker-originated connections killed via `ss --kill` immediately on defend |
| 🔒 **Privilege-Escalation Hardening** | UFW defend applies 5 kernel sysctl params: kptr\_restrict, dmesg\_restrict, ptrace\_scope, perf\_event\_paranoid, unprivileged\_userns\_clone — persisted to sysctl.d |
| 🧬 **Chkrootkit False-Positive Detection** | Promiscuous-mode NIC (IDS/sniffer) detected automatically; demoted to info rather than alerting |
| 🗄️ **AIDE Auto-Init** | Defend auto-initializes the AIDE integrity database when absent; live changed/added/removed file paths shown on next scan |
| 🌍 **Vuln Scanner Service Management** | GVM, OpenVAS, Nessus services auto-started by Defend when found stopped/failed |
| 📅 **Lynis Auto-Hardening** | 19 kernel/network sysctl parameters written to `/etc/sysctl.d/99-kjer-hardening.conf` and applied on defend; Hardening Index re-checked |
| 🐱 **Tiger Auto-Remediation** | Sticky bit on /tmp, /root permissions, and SUID core dump params fixed automatically before re-audit |
| 🛸 **Suricata IPS Mode Switch** | Defend reloads rules via `suricatasc` (live reload, maintains IPS mode) before falling back to `systemctl restart` |
| 📐 **Sequential Phase Engine** | Scan and Defend phases execute strictly in order — no result ever appears under the wrong phase header |
| 🎯 **Accurate Severity Levels** | All backend hardening steps return `success / warning / error` based on real command exit codes |

---

## 🆕 Changelog

### v1.1 — 2026-03-28

**Network scanning overhauled — hosts are now reliably found**
- Replaced direct `nmap -sn` GUI call with a multi-method Python backend (`scan-network`):
  1. ARP cache — reads `/proc/net/arp` + `ip neigh show` (zero extra packets, no privileges needed)
  2. `arp-scan --localnet` — fastest ARP broadcast sweep when installed
  3. `nmap -sn -T4` with `sudo -n` prefix for ARP-based ping (finds hosts that block ICMP)
  4. Subnet auto-detected from `ip route show default` → falls back to `ip -4 addr show`
- Static OUI vendor lookup (~30 common prefixes) — no network request needed
- Hostnames resolved via `socket.getfqdn` for the first 20 discovered hosts

**Rich per-device scan**
- New `scan-device` backend: `nmap -sV -O -T4 --script=banner,ssh-hostkey,smb-os-discovery,http-title,ssl-cert`
- Returns structured JSON: hostname, OS + accuracy %, MAC, vendor, latency, uptime guess, full port list, script outputs
- Runs with `sudo -n` prefix for OS detection; gracefully falls back to ping + ARP if nmap absent
- Enriched data persisted to device records and shown on device cards

**Bulk scan & defend**
- Select Any / All devices via per-card checkboxes and a "Select All" master checkbox
- **Bulk Scan**: scans all selected devices sequentially; combined results modal updates each device row live
- Combined results modal: per-device expandable rows — hostname, OS, MAC/vendor, latency, uptime, full port table
- **Bulk Defend**: opens a summary modal listing all selected devices with port counts; each device has an individual Defend button leading to its defence console

**Enriched device cards**
- Cards now surface: vendor, hostname (when distinct from name), latency, open port count, top 3 service tags

**Promo / trial license system**
- Time-limited promo keys: 7-day (`KJER-P7DY-YT26-FREE-2026`) and 30-day (`KJER-P30D-YT26-FREE-2026`)
- HWID-locked: each physical device can only redeem one promo key, ever
- Registry stored in `~/.kjer/promo_registry.json` as SHA-256 hashes — no plaintext HWID on disk
- Expiry enforced on every activation check; expired promos clear activation state automatically
- GUI shows expiry date in license status and sidebar

**Bug fixes**
- `check-activation` was accidentally removed from `ACTION_MAP` — restored
- `--target-ip` argparse parameter added for `scan-network` and `scan-device` commands
| 🖥️ **Professional GUI** | Dark theme, Electron-based, OS-adaptive tool display |
| 💻 **Full CLI** | Complete command-line interface for power users |
| 🧩 **Profile-Based** | Install entire security suites with one command — tier-limited |
| 🔍 **Smart OS Detection** | Auto-detects distro and selects compatible tools |
| 🌐 **Network Management** | Discover, monitor, and defend LAN devices remotely |
| 🔗 **Peer Approval System** | Device connection requests require owner approval — no silent access |
| 🏷️ **Four License Tiers** | Personal, Home, Enterprise, and Industrial — hardware-bound, purchased via Stripe |
| 🔄 **Auto-Update Check** | Checks GitHub Releases for newer versions on startup |
| 🔎 **7-Phase Smart Scan** | Network · Vulnerability · Malware · File Integrity · Memory Forensics · Compliance · SIEM |
| 🛡️ **7-Phase Smart Defense** | Real hardening commands: scanner service restore, firewall + IP blocking + session kill, IPS, AV, access control, file integrity, audit |
| 🚀 **Run Button (Scan + Defend)** | Single-click executes the full scan then immediately applies defense — no manual chaining required |
| 📊 **Report Wizard** | Export scan + defense results as HTML, Markdown, JSON, or plain text — available any time, mid-session or post-scan |
| 👁️ **Monitor Checkbox** | Check before clicking Run to keep Kjer polling continuously every 5 minutes after the initial scan+defend cycle completes |
| 🔁 **Monitor Mode Engine** | 5-min sequential tool polling; silent unless a finding level changes; auto-defends every new/escalated threat in-line with scan output |
| 📋 **Monitor Activity Summary in Reports** | Reports include a dedicated Monitor section — total events, threat vs auto-defend breakdown, full chronological event list |
| 💾 **Persistent Activity Log** | Full session log of all scan, defense, and monitor events accumulates without clearing until Kjer is closed; persists across restarts via localStorage |
| 📝 **Rich Finding Detail** | Every finding includes file paths, check names, or specific rule violations — not just counts |
| 🔌 **Attacker IP Extraction** | On defend, Kjer parses Suricata fast.log / eve.json and Zeek conn.log for source IPs and blocks them via iptables |
| 🛑 **Active Session Termination** | Attacker-originated connections killed via `ss --kill` immediately on defend |
| 🔒 **Privilege-Escalation Hardening** | UFW defend applies 5 kernel sysctl params: kptr\_restrict, dmesg\_restrict, ptrace\_scope, perf\_event\_paranoid, unprivileged\_userns\_clone — persisted to sysctl.d |
| 🧬 **Chkrootkit False-Positive Detection** | Promiscuous-mode NIC (IDS/sniffer) detected automatically; demoted to info rather than alerting |
| 🗄️ **AIDE Auto-Init** | Defend auto-initializes the AIDE integrity database when absent; live changed/added/removed file paths shown on next scan |
| 🌍 **Vuln Scanner Service Management** | GVM, OpenVAS, Nessus services auto-started by Defend when found stopped/failed |
| 📅 **Lynis Auto-Hardening** | 19 kernel/network sysctl parameters written to `/etc/sysctl.d/99-kjer-hardening.conf` and applied on defend; Hardening Index re-checked |
| 🐱 **Tiger Auto-Remediation** | Sticky bit on /tmp, /root permissions, and SUID core dump params fixed automatically before re-audit |
| 🛸 **Suricata IPS Mode Switch** | Defend reloads rules via `suricatasc` (live reload, maintains IPS mode) before falling back to `systemctl restart` |
| 📐 **Sequential Phase Engine** | Scan and Defend phases execute strictly in order — no result ever appears under the wrong phase header |
| 🎯 **Accurate Severity Levels** | All backend hardening steps return `success / warning / error` based on real command exit codes |

---

## 💳 License Tiers

| Feature | Personal | Home | Enterprise | Industrial |
|---------|----------|------|------------|------------|
| **Automation Intensity** | **Assisted** | **Semi-Auto** | **Fully Automated** | **Autonomous** |
| Trigger Model | Manual only | Scheduled scans | Auto-scan + auto-defend | Policy-driven, zero-touch |
| Scheduled Scans | ✗ | ✓ | ✓ | ✓ |
| Auto-Defend | ✗ | ✗ | ✓ | ✓ |
| Policy Engine | ✗ | ✗ | ✗ | ✓ |
| Devices | 1 | 7 | 25 | 100 |
| Custom Profiles | 3 | 15 | 50 | 100 |
| Network Management | ✓ | ✓ | ✓ | ✓ |
| Hardware-Bound | ✓ | ✓ | ✓ | ✓ |
| Stripe Purchase | ✓ | ✓ | ✓ | ✓ |
| GUI & CLI | ✓ | ✓ | ✓ | ✓ |
| Support | Standard | Standard | Priority | Priority |
| Purchase | [phanesguild.com/kjer](https://phanesguild.com/kjer) | [phanesguild.com/kjer](https://phanesguild.com/kjer) | [phanesguild.com/kjer](https://phanesguild.com/kjer) | [phanesguild.com/kjer](https://phanesguild.com/kjer) |

**License key format:**
- `KJER-XXXX-...` — Personal
- `KJER-HOM-...` — Home
- `KJER-ENT-...` — Enterprise
- `KJER-IND-...` — Industrial

---

## 🔒 Code Protection & Runtime

Critical Python files in `lib/` are protected with PyArmor (obfuscated + root-owned).

- `lib/activation.py` and `lib/backend_api.py` are set `chmod 700 / root:root` after full installation.
- `kjer-install.sh` adjusts execute permissions so the CLI can invoke them as the current user.
- If you see `ModuleNotFoundError: No module named 'pyarmor_runtime_000000'`, run:
  ```bash
  sudo bash copy-pyarmor-runtime.sh
  ```

---

## 🧹 Removing Kjer

| OS | Command |
|----|---------|
| Linux | `sudo bash installer/uninstall-kjer.sh` |
| macOS | `bash installer/uninstall-mac.sh` |
| Windows | `powershell -ExecutionPolicy Bypass -File installer\uninstall-windows.ps1` |

---

##  Additional Documentation

| Document | Description |
|----------|-------------|
| [docs/LINUX_CLI_GUIDE.md](docs/LINUX_CLI_GUIDE.md) | Linux CLI deep dive |


---

## 📞 Support & Sales

- **Website**: https://phanesguild.com/kjer
- **Email**: support@phanesguild.com
- **Docs**: https://docs.phanesguild.com/kjer

---

**Copyright © 2026 PhanesGuild Software. All Rights Reserved.**  
*Kjer — Ultimate Cybersecurity Tool Management*
