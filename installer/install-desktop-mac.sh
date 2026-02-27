#!/bin/bash
# Automated installer for Kjer Electron desktop wrapper on macOS
set -e

print_info() {
    echo -e "\033[0;34m[*]\033[0m $1"
}
print_success() {
    echo -e "\033[0;32m[+]\033[0m $1"
}
print_error() {
    echo -e "\033[0;31m[-]\033[0m $1"
}

cd "$(dirname "$0")/../desktop"

print_info "Installing Node.js dependencies for Kjer Desktop (macOS)..."
if ! command -v npm &> /dev/null; then
    print_error "npm (Node.js) is required."
    # Try to install via Homebrew automatically
    if command -v brew &> /dev/null; then
        print_info "Installing Node.js via Homebrew..."
        brew install node
        if ! command -v npm &> /dev/null; then
            print_error "npm still not found after brew install. Please install Node.js: https://nodejs.org"
            exit 1
        fi
        print_success "Node.js installed via Homebrew: $(node --version)"
    else
        print_error "Homebrew not found. Install Node.js first: https://nodejs.org  or  install Homebrew: https://brew.sh"
        exit 1
    fi
else
    print_success "Node.js found: $(node --version)  |  npm: $(npm --version)"
fi
npm install
print_success "Node.js dependencies installed."

print_info "Creating macOS .app bundle..."
npx electron-packager . Kjer --platform=darwin --arch=x64 --icon=icon.icns --overwrite

APP_PATH="$(pwd)/Kjer-darwin-x64/Kjer.app"
if [ -d "$APP_PATH" ]; then
    print_success "Kjer.app created at $APP_PATH"
    # Optionally move to /Applications
    # macOS: prompt for admin if needed
    sudo cp -R "$APP_PATH" "/Applications/Kjer.app"
    sudo chown -R root:admin "/Applications/Kjer.app"
    sudo chmod -R 755 "/Applications/Kjer.app"
    print_success "Kjer Desktop app installed to /Applications! (admin permissions required)"
else
    print_error "Failed to create Kjer.app bundle."
    exit 1
fi

# ─── CLI setup ────────────────────────────────────────────────────────────────
INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_PATH="$INSTALLER_DIR/../scripts/kjer-cli.py"

if [ -f "$CLI_PATH" ]; then
    chmod +x "$CLI_PATH"
    print_success "CLI script permissions updated"

    if [ ! -L /usr/local/bin/kjer ]; then
        sudo ln -s "$CLI_PATH" /usr/local/bin/kjer
        print_success "Created symlink: /usr/local/bin/kjer"
        print_info "You can now use: kjer [command]"
    else
        print_info "CLI symlink already exists: /usr/local/bin/kjer"
    fi
else
    print_error "CLI script not found at $CLI_PATH — skipping CLI symlink"
fi

print_info ""
print_info "Kjer CLI commands (macOS):"
print_info "  kjer              Launch interactive menu"
print_info "  kjer --gui        Launch the Kjer GUI app"
print_info "  kjer --status     Show installation status"
print_info "  kjer --list       List available tools"
print_info "  kjer --version    Show version"
print_info "  kjer --help       Show help"
print_info ""
print_info "Note: initialization is done exclusively through the GUI."
