#!/bin/bash
# =============================================================================
#  kjer-install.sh  —  Kjer Dependency Bootstrapper
#  Run this ONCE before using kjer for the first time.
#  It installs all runtime dependencies (Python libs, Node.js, Electron)
#  and wires up the 'kjer' CLI command — no prior initialization required.
#
#  Usage:
#    bash installer/kjer-install.sh          # from the Kjer root directory
#    bash installer/kjer-install.sh --no-gui # skip Electron/Node install
#
#  Supported:
#    Linux  — apt (Debian/Ubuntu), dnf (Fedora/RHEL), pacman (Arch), zypper (openSUSE)
#    macOS  — Homebrew (auto-installed if absent)
# =============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; MAGENTA='\033[1;35m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
info() { echo -e "${CYAN}  →${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*"; }
hdr()  { echo -e "\n${MAGENTA}── $* ──${NC}"; }

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KJER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$KJER_ROOT/desktop"
LIB_DIR="$KJER_ROOT/lib"
SCRIPTS_DIR="$KJER_ROOT/scripts"
CLI_SCRIPT="$SCRIPTS_DIR/kjer-cli.py"

# ── Options ─────────────────────────────────────────────────────────────────
SKIP_GUI=false
for arg in "$@"; do
    [[ "$arg" == "--no-gui" ]] && SKIP_GUI=true
done

# ── OS Detection ────────────────────────────────────────────────────────────
detect_os() {
    SYS="$(uname -s)"
    case "$SYS" in
        Linux)   OS_TYPE="linux" ;;
        Darwin)  OS_TYPE="macos" ;;
        *)       err "Unsupported OS: $SYS.  Use kjer-install.ps1 on Windows."; exit 1 ;;
    esac

    if [[ "$OS_TYPE" == "linux" ]] && [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO_NAME="${NAME:-Unknown}"
    else
        DISTRO_NAME="$SYS"
    fi
    ok "Detected: $DISTRO_NAME"

    # Write install state so the GUI and CLI know the OS without user-agent detection
    mkdir -p "$HOME/.kjer"
    INSTALL_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    cat > "$HOME/.kjer/install_state.json" <<EOF
{
  "os": "$OS_TYPE",
  "distro": "$DISTRO_NAME",
  "installed_at": "$INSTALL_TS",
  "install_path": "$KJER_ROOT"
}
EOF
    ok "Install state written to ~/.kjer/install_state.json"
}

# ── Package manager helpers ──────────────────────────────────────────────────
PM=""
detect_pkg_manager() {
    if   command -v apt-get &>/dev/null; then PM="apt"
    elif command -v dnf     &>/dev/null; then PM="dnf"
    elif command -v pacman  &>/dev/null; then PM="pacman"
    elif command -v zypper  &>/dev/null; then PM="zypper"
    elif command -v brew    &>/dev/null; then PM="brew"
    else PM=""
    fi
}

pkg_install() {
    # pkg_install <pkg1> [pkg2...]
    case "$PM" in
        apt)    sudo apt-get install -y "$@" ;;
        dnf)    sudo dnf install -y "$@" ;;
        pacman) sudo pacman -S --noconfirm "$@" ;;
        zypper) sudo zypper install -y "$@" ;;
        brew)   brew install "$@" ;;
        *)      err "No supported package manager found."; return 1 ;;
    esac
}

# ── Step 1: Python 3 ─────────────────────────────────────────────────────────
check_python() {
    hdr "Python 3"
    if command -v python3 &>/dev/null; then
        PYVER="$(python3 --version 2>&1)"
        ok "Found: $PYVER"
    else
        info "Python 3 not found — installing..."
        detect_pkg_manager
        if [[ "$OS_TYPE" == "macos" ]]; then
            ensure_brew
            brew install python3
        else
            case "$PM" in
                apt)    sudo apt-get update -qq && sudo apt-get install -y python3 python3-pip ;;
                dnf)    sudo dnf install -y python3 python3-pip ;;
                pacman) sudo pacman -S --noconfirm python python-pip ;;
                zypper) sudo zypper install -y python3 python3-pip ;;
                *)      err "Cannot install Python 3 automatically. Install from https://python.org"; exit 1 ;;
            esac
        fi
        ok "Python 3 installed."
    fi

    # pip
    if ! command -v pip3 &>/dev/null && ! python3 -m pip --version &>/dev/null 2>&1; then
        info "pip not found — installing..."
        detect_pkg_manager
        [[ "$PM" == "apt" ]]    && sudo apt-get install -y python3-pip
        [[ "$PM" == "dnf" ]]    && sudo dnf install -y python3-pip
        [[ "$PM" == "pacman" ]] && sudo pacman -S --noconfirm python-pip
        [[ "$PM" == "zypper" ]] && sudo zypper install -y python3-pip
        [[ "$PM" == "brew" ]]   && brew install python3   # includes pip
    fi

    # pyyaml (required by kjer-cli.py)
    if ! python3 -c "import yaml" &>/dev/null; then
        info "Installing PyYAML..."
        python3 -m pip install --quiet pyyaml
        ok "PyYAML installed."
    else
        ok "PyYAML already available."
    fi
}

# ── Step 2: Fix lib/ permissions ─────────────────────────────────────────────
#  The full installer sets lib/ files to root:root 700 for protection.
#  The CLI must be able to execute them via subprocess as the current user,
#  so we grant execute permission to the owner (root) and make them world-executable.
fix_lib_permissions() {
    hdr "Library Permissions"
    if [ -d "$LIB_DIR" ]; then
        local needs_fix=false
        for f in "$LIB_DIR"/*.py; do
            [ -f "$f" ] || continue
            if ! [ -x "$f" ]; then
                needs_fix=true
                break
            fi
        done

        if $needs_fix; then
            info "Fixing execute permissions on lib/*.py (requires sudo)..."
            sudo chmod a+x "$LIB_DIR"/*.py 2>/dev/null || true
            # If files are root-owned and not readable, also add world-read
            sudo chmod a+r "$LIB_DIR"/*.py 2>/dev/null || true
            ok "lib/*.py permissions updated."
        else
            ok "lib/*.py permissions OK."
        fi

        # pyarmor runtime dir
        if [ -d "$LIB_DIR/pyarmor_runtime_000000" ]; then
            sudo chmod a+rx "$LIB_DIR/pyarmor_runtime_000000" 2>/dev/null || true
            sudo chmod a+r  "$LIB_DIR/pyarmor_runtime_000000"/*.so 2>/dev/null || true
            ok "pyarmor_runtime_000000 permissions OK."
        fi
    else
        warn "lib/ directory not found at $LIB_DIR — skipping."
    fi
}

# ── Step 3: CLI symlink ───────────────────────────────────────────────────────
setup_cli() {
    hdr "CLI Symlink  ( /usr/local/bin/kjer )"
    if [ ! -f "$CLI_SCRIPT" ]; then
        err "CLI script not found: $CLI_SCRIPT"; exit 1
    fi
    chmod +x "$CLI_SCRIPT"

    if [ -L /usr/local/bin/kjer ]; then
        ok "Symlink already exists: /usr/local/bin/kjer"
    elif [ -f /usr/local/bin/kjer ]; then
        warn "/usr/local/bin/kjer exists but is not a symlink — leaving it alone."
    else
        info "Creating /usr/local/bin/kjer → $CLI_SCRIPT (requires sudo)..."
        sudo ln -s "$CLI_SCRIPT" /usr/local/bin/kjer
        ok "Symlink created — 'kjer' is now a global command."
    fi

    # Also wire up the kjer-gui launcher
    if [ -f "$SCRIPTS_DIR/kjer-gui" ]; then
        chmod +x "$SCRIPTS_DIR/kjer-gui"
        if ! [ -L /usr/local/bin/kjer-gui ] && ! [ -f /usr/local/bin/kjer-gui ]; then
            sudo ln -s "$SCRIPTS_DIR/kjer-gui" /usr/local/bin/kjer-gui 2>/dev/null || true
        fi
        ok "gdje-gui launcher executable."
    fi
}

# ── Step 4: Node.js + Electron ───────────────────────────────────────────────
ensure_brew() {
    if ! command -v brew &>/dev/null; then
        info "Homebrew not found — installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    PM="brew"
}

install_nodejs() {
    hdr "Node.js & npm"
    if command -v node &>/dev/null && command -v npm &>/dev/null; then
        ok "Node.js $(node --version)  |  npm $(npm --version)"
        return 0
    fi
    info "Node.js not found — installing..."
    detect_pkg_manager
    if [[ "$OS_TYPE" == "macos" ]]; then
        ensure_brew
        brew install node
    else
        case "$PM" in
            apt)
                # Prefer NodeSource LTS for a recent version
                if command -v curl &>/dev/null; then
                    info "Adding NodeSource LTS repository..."
                    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                else
                    sudo apt-get update -qq
                    sudo apt-get install -y nodejs npm
                fi
                ;;
            dnf)    sudo dnf install -y nodejs npm ;;
            pacman) sudo pacman -S --noconfirm nodejs npm ;;
            zypper) sudo zypper install -y nodejs npm ;;
            *)
                err "Cannot install Node.js automatically."
                info "Install from https://nodejs.org then re-run: bash installer/kjer-install.sh"
                exit 1
                ;;
        esac
    fi

    if command -v node &>/dev/null; then
        ok "Node.js installed: $(node --version)"
    else
        warn "Node.js install may require a new terminal session. Re-run this script after opening a new terminal."
        exit 0
    fi
}

install_electron() {
    hdr "Electron (GUI engine)"
    if [ ! -f "$DESKTOP_DIR/package.json" ]; then
        warn "desktop/package.json not found — skipping Electron install."
        return 0
    fi

    LOCAL_ELECTRON="$DESKTOP_DIR/node_modules/.bin/electron"
    if [ ! -f "$LOCAL_ELECTRON" ]; then
        info "Running npm install in $DESKTOP_DIR ..."
        (cd "$DESKTOP_DIR" && npm install 2>&1 | tail -5)
    fi

    if [ -f "$LOCAL_ELECTRON" ]; then
        ok "Electron installed: $LOCAL_ELECTRON"
    else
        warn "npm install completed but Electron binary not confirmed."
        warn "Try running: cd $DESKTOP_DIR && npm install"
        return 0
    fi

    # Fix chrome-sandbox SUID permissions — required on Linux for Electron to launch.
    # Runs whether Electron was just installed or was already present.
    # Must run as root (installer is expected to be called with sudo).
    SANDBOX="$DESKTOP_DIR/node_modules/electron/dist/chrome-sandbox"
    if [ -f "$SANDBOX" ]; then
        if sudo chown root:root "$SANDBOX" 2>/dev/null && sudo chmod 4755 "$SANDBOX" 2>/dev/null; then
            ok "Electron sandbox permissions set (chrome-sandbox 4755 root:root)."
        else
            warn "Could not set sandbox permissions automatically."
            warn "Run manually: sudo chown root:root \"$SANDBOX\" && sudo chmod 4755 \"$SANDBOX\""
            info "Alternatively, Kjer will fall back to --no-sandbox mode automatically."
        fi
    fi
}

# ── Step 5: Summary ───────────────────────────────────────────────────────────
show_summary() {
    echo
    echo -e "${MAGENTA}══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Kjer dependencies installed successfully!${NC}"
    echo -e "${MAGENTA}══════════════════════════════════════════════${NC}"
    echo
    echo -e "${CYAN}Next steps:${NC}"
    echo
    echo -e "  1. Launch the GUI to activate your license and initialize Kjer:"
    echo -e "     ${GREEN}kjer --gui${NC}"
    echo
    echo -e "  2. In the GUI:"
    echo -e "     ${CYAN}a)${NC} Enter your license key"
    echo -e "     ${CYAN}b)${NC} Click 'Initialize'"
    echo -e "     ${CYAN}c)${NC} Complete OS detection"
    echo
    echo -e "  3. Once initialized, the full CLI is available:"
    echo
    echo -e "     ${YELLOW}kjer${NC}             Interactive menu"
    echo -e "     ${YELLOW}kjer --status${NC}    Activation & system status"
    echo -e "     ${YELLOW}kjer --list${NC}      Browse available security tools"
    echo -e "     ${YELLOW}kjer --gui${NC}       Re-open the GUI"
    echo -e "     ${YELLOW}kjer --help${NC}      Full command reference"
    echo
    echo -e "  Need a license? ${CYAN}https://phanesguild.com/kjer${NC}"
    echo
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
    echo
    echo -e "${MAGENTA}  ██╗  ██╗     ██╗███████╗██████╗ ${NC}"
    echo -e "${MAGENTA}  ██║ ██╔╝     ██║██╔════╝██╔══██╗${NC}"
    echo -e "${MAGENTA}  █████╔╝      ██║█████╗  ██████╔╝${NC}"
    echo -e "${MAGENTA}  ██╔═██╗ ██   ██║██╔══╝  ██╔══██╗${NC}"
    echo -e "${MAGENTA}  ██║  ██╗╚█████╔╝███████╗██║  ██║${NC}"
    echo -e "${MAGENTA}  ╚═╝  ╚═╝ ╚════╝ ╚══════╝╚═╝  ╚═╝${NC}"
    echo -e "${CYAN}         Dependency Bootstrapper v1.0.0${NC}"
    echo

    detect_os
    check_python
    fix_lib_permissions
    setup_cli

    if $SKIP_GUI; then
        info "Skipping GUI/Electron install (--no-gui specified)."
    else
        install_nodejs
        install_electron
    fi

    show_summary
}

main
