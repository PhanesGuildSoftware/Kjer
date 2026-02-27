#!/bin/bash
# Cross-platform Kjer initialization script
# Detects OS and runs only the appropriate setup

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

OS_TYPE="$(uname -s)"

if [[ "$OS_TYPE" == "Linux" ]]; then
    print_info "Linux detected. Running Linux CLI setup."
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root. Please run with: sudo bash init-kjer.sh"
        exit 1
    fi
    bash "$(dirname "$0")/install-linux.sh"
    print_success "Linux CLI setup complete."
    print_info "Setting up Kjer Desktop wrapper..."
    bash "$(dirname "$0")/install-desktop.sh"
    print_success "Kjer Desktop wrapper setup complete."
    exit 0
elif [[ "$OS_TYPE" == "Darwin" ]]; then
    print_info "macOS detected. Running desktop wrapper setup..."
    bash "$(dirname "$0")/install-desktop-mac.sh"
    print_success "Kjer Desktop wrapper setup complete."
    exit 0
elif [[ "$OS_TYPE" =~ MINGW|MSYS|CYGWIN ]]; then
    print_info "Windows detected. Running PowerShell CLI and desktop setup..."
    pwsh -File "$(dirname "$0")/install-windows.ps1"
    pwsh -File "$(dirname "$0")/install-desktop-windows.ps1"
    print_success "Windows CLI and desktop wrapper setup complete."
    exit 0
else
    print_error "Unsupported OS: $OS_TYPE"
    exit 1
fi
