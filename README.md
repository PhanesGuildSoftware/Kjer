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
| 📦 **Real Installations** | Uses apt / dnf / pacman / zypper / winget — no simulations |
| 🖥️ **Professional GUI** | Dark theme, Electron-based, OS-adaptive tool display |
| 💻 **Full CLI** | Complete command-line interface for power users |
| 🧩 **Profile-Based** | Install entire security suites with one command — tier-limited |
| 🔍 **Smart OS Detection** | Auto-detects distro and selects compatible tools |
| 🌐 **Network Management** | Discover, monitor, and defend LAN devices remotely |
| 🔗 **Peer Approval System** | Device connection requests require owner approval — no silent access |
| 🏷️ **Four License Tiers** | Personal, Home, Enterprise, and Industrial — hardware-bound, purchased via Stripe |
| 🔄 **Auto-Update Check** | Checks GitHub Releases for newer versions on startup |
| 🔎 **7-Phase Smart Scan** | Network · Vulnerability · Malware · File Integrity · Memory Forensics · Compliance · SIEM |
| 🛡️ **7-Phase Smart Defense** | Real hardening commands: scanner service restore, firewall, IPS, AV, access control, file integrity, audit |
| 📊 **Report Wizard** | Export scan + defense results as PDF, HTML, Markdown, or plain text |
| 🔬 **Compliance Audit** | Lynis, CIS-CAT, osquery, auditd, TIGER — gaps surfaced with actionable hardening steps |
| 🧬 **Chkrootkit False-Positive Detection** | Identify promiscuous mode (IDS/sniffer) as root cause; cross-verify with debsums + rkhunter |
| 🗄️ **AIDE Auto-Init** | Defend auto-initializes the AIDE integrity database when it doesn't exist; live `changed/added/removed` parse when DB exists |
| 🌍 **Vuln Scanner Service Management** | GVM, OpenVAS, Nessus services auto-started by Defend when found stopped/failed |
| 📐 **Sequential Phase Engine** | Scan and Defend phases execute strictly in order — no result ever appears under the wrong phase header |
| 🎯 **Accurate Severity Levels** | All backend hardening steps return `success / warning / error` based on real command exit codes |
| 💻 **CLI v1.1** | 7-phase scan output with phase headers, backend-driven defend with real hardening summaries, `--about` updated |

---

## 💳 License Tiers

| Feature | Personal | Home | Enterprise | Industrial |
|---------|----------|------|------------|------------|
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

## 📖 Additional Documentation

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
