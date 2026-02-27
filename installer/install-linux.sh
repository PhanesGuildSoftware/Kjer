    # Ensure tools database is available system-wide
    if [ ! -f /usr/local/db/defensive-tools-db.yaml ]; then
        mkdir -p /usr/local/db
        cp "$(cd "$(dirname "$0")/.." && pwd)/db/defensive-tools-db.yaml" /usr/local/db/
        chown root:root /usr/local/db/defensive-tools-db.yaml
        chmod 644 /usr/local/db/defensive-tools-db.yaml
        print_success "Copied tools database to /usr/local/db/defensive-tools-db.yaml"
    fi
#!/bin/bash

# Kjer Linux Setup Script
# Automated installation and configuration for Linux systems

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "\n${CYAN}================================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}================================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_error() {
    echo -e "${RED}[-]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root"
        print_info "Run: sudo ./install-linux.sh"
        exit 1
    fi
}

check_os() {
    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        print_error "This script is for Linux systems only"
        exit 1
    fi
    print_success "Linux system detected"
}

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
        print_info "Detected: $OS $VER"
    else
        print_warning "Could not detect Linux distribution"
        OS="Unknown"
    fi
}

check_python() {
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed"
        print_info "Installing Python 3..."
        apt-get update
        apt-get install -y python3 python3-pip
        print_success "Python 3 installed"
    else
        PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
        print_success "Python 3 found: $PYTHON_VERSION"
    fi
}

setup_nodejs() {
    print_header "Setting up Node.js & Electron"

    if command -v node &> /dev/null && command -v npm &> /dev/null; then
        NODE_VER=$(node --version 2>&1)
        NPM_VER=$(npm --version 2>&1)
        print_success "Node.js found: $NODE_VER  |  npm: $NPM_VER"
    else
        print_info "Node.js not found — installing via system package manager..."

        if command -v apt-get &> /dev/null; then
            print_info "Detected: apt (Debian/Ubuntu)"
            apt-get update -qq
            apt-get install -y nodejs npm
        elif command -v dnf &> /dev/null; then
            print_info "Detected: dnf (Fedora/RHEL)"
            dnf install -y nodejs npm
        elif command -v pacman &> /dev/null; then
            print_info "Detected: pacman (Arch Linux)"
            pacman -S --noconfirm nodejs npm
        elif command -v zypper &> /dev/null; then
            print_info "Detected: zypper (openSUSE)"
            zypper install -y nodejs npm
        else
            print_warning "Unknown package manager — skipping Node.js install"
            print_info "Install manually: https://nodejs.org"
            return
        fi

        if command -v node &> /dev/null; then
            print_success "Node.js installed: $(node --version)"
        else
            print_warning "Node.js install may need a new shell session"
        fi
    fi

    # Run npm install in desktop/ to install local Electron
    KJER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    DESKTOP_DIR="$KJER_ROOT/desktop"
    if [ -f "$DESKTOP_DIR/package.json" ]; then
        print_info "Installing Electron in $DESKTOP_DIR (npm install)..."
        cd "$DESKTOP_DIR" && npm install 2>&1 | tail -3
        if [ -f "$DESKTOP_DIR/node_modules/.bin/electron" ]; then
            print_success "Electron installed: $DESKTOP_DIR/node_modules/.bin/electron"
        else
            print_warning "npm install ran — Electron binary not yet confirmed (may need new terminal)"
        fi
        cd - > /dev/null
    else
        print_warning "desktop/package.json not found — skipping Electron install"
    fi
}

setup_cli() {
    print_header "Setting up Kjer CLI"
    # Robustly find the CLI script relative to installer dir
    INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
    CLI_PATH="$INSTALLER_DIR/../scripts/kjer-cli.py"
    if [ ! -f "$CLI_PATH" ]; then
        print_error "CLI script not found at $CLI_PATH"
        exit 1
    fi
    chmod +x "$CLI_PATH"
    print_success "CLI script permissions updated"
    # Create symlink for easy access
    if [ ! -L /usr/local/bin/kjer ]; then
        ln -s "$CLI_PATH" /usr/local/bin/kjer
        print_success "Created symlink: /usr/local/bin/kjer"
        print_info "You can now use: kjer [command]"
    fi
}

install_optional_tools() {
    print_header "Installing Optional Base Tools"
    
    print_info "Installing common security tool dependencies..."
    
    # Basic dependencies
    apt-get update
    apt-get install -y \
        curl \
        wget \
        git \
        vim \
        apt-utils \
        software-properties-common
    
    print_success "Optional tools installed"
}

show_next_steps() {
    print_header "Installation Complete!"
    
    echo -e "${GREEN}Kjer is ready to use!${NC}\n"
    
    echo "Next steps:"
    echo ""
    echo "  1. Launch the GUI and initialize:"
    echo "     ${CYAN}kjer --gui${NC}"
    echo "     ${YELLOW}(Initialization is done exclusively through the GUI)${NC}"
    echo ""
    echo "  2. After initialization, launch the interactive menu:"
    echo "     ${CYAN}kjer${NC}"
    echo ""
    echo "  3. Or use direct commands:"
    echo "     ${CYAN}kjer --status${NC}     # Show installation status"
    echo "     ${CYAN}kjer --list${NC}       # List available tools"
    echo "     ${CYAN}kjer --version${NC}    # Show version"
    echo "     ${CYAN}kjer --help${NC}       # Show help"
    echo ""
    echo "For full documentation:"
    echo "     ${CYAN}cat docs/LINUX_CLI_GUIDE.md${NC}"
    echo ""
}

main() {
    print_header "Kjer Linux Security Framework - Setup"
    # Require root
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root. Please run with: sudo ./install-linux.sh"
        exit 1
    fi
    # Checks
    print_info "Running system checks..."
    check_os
    detect_distro
    echo ""
    read -p "Continue with setup? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Setup cancelled"
        exit 0
    fi
    # Setup
    print_header "System Preparation"
    check_python
    setup_nodejs
    install_optional_tools
    setup_cli
    # Set permissions for all Kjer files/folders
    KJER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    chown -R root:root "$KJER_ROOT"
    # Make all .sh scripts in installer/ executable (for user convenience)
    find "$KJER_ROOT/installer" -type f -name "*.sh" -exec chmod 755 {} +
    # Make all .py scripts in installer/ and scripts/ executable
    find "$KJER_ROOT/installer" -type f -name "*.py" -exec chmod 755 {} +
    find "$KJER_ROOT/scripts" -type f -name "*.py" -exec chmod 755 {} +
    # Also ensure main binaries in root are executable
    chmod 755 "$KJER_ROOT/scripts/kjer-cli.py" 2>/dev/null || true
    chmod 755 "$KJER_ROOT/installer/init-kjer.sh" 2>/dev/null || true
    chmod 755 "$KJER_ROOT/installer/install-linux.sh" 2>/dev/null || true
    chmod 755 "$KJER_ROOT/installer/install-desktop.sh" 2>/dev/null || true
    chmod 755 "$KJER_ROOT/installer/uninstall-kjer.sh" 2>/dev/null || true
    chmod 755 "$KJER_ROOT/installer/install-desktop-mac.sh" 2>/dev/null || true
    chmod 755 "$KJER_ROOT/installer/uninstall-mac.sh" 2>/dev/null || true
    # Set all folders to 755
    find "$KJER_ROOT" -type d -exec chmod 755 {} +
    # Summary
    show_next_steps
}

# Run main
main
