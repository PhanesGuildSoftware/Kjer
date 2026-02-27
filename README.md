# Kjer — Professional Cybersecurity Tool Management Platform

**Version 1.0.0** · PhanesGuild Software · [https://phanesguild.com/kjer](https://phanesguild.com/kjer)

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

# Upgrade to a higher license tier
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
| 🧩 **Profile-Based** | Install entire security suites with one command |
| 🔍 **Smart OS Detection** | Auto-detects distro and selects compatible tools |
| ⬆️ **License Upgrades** | Upgrade tiers without reinstalling via `kjer --upgrade` |

---

## 🆚 Kjer vs HakPak

| Feature | HakPak (Free) | Kjer (Premium) |
|---------|---------------|----------------|
| Price | Free | $99–$999/yr |
| License | Open source | Commercial |
| Real Installs | Linux only | Cross-platform |
| GUI | No | Electron (dark theme) |
| Piracy Protection | None | Hardware-bound |
| Support | Community | Professional |

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
| [docs/ARCHITECTURE_DEEP_DIVE.md](docs/ARCHITECTURE_DEEP_DIVE.md) | Internal architecture |
| [docs/VERSIONING_AND_UPGRADES.md](docs/VERSIONING_AND_UPGRADES.md) | License tiers & upgrade paths |
| [docs/BUSINESS_MODEL_AND_EXAMPLES.md](docs/BUSINESS_MODEL_AND_EXAMPLES.md) | Pricing & use-case examples |

---

## 📞 Support & Sales

- **Website**: https://phanesguild.com/kjer
- **Email**: support@phanesguild.com
- **Docs**: https://docs.phanesguild.com/kjer

---

**Copyright © 2026 PhanesGuild Software. All Rights Reserved.**  
*Kjer — Ultimate Cybersecurity Tool Management*
