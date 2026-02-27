#!/bin/bash
# Automated installer for Kjer Electron desktop wrapper
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

print_info "Installing Node.js dependencies for Kjer Desktop..."
if ! command -v npm &> /dev/null; then
    print_error "npm (Node.js) is required. Please install Node.js first."
    exit 1
fi
npm install
print_success "Node.js dependencies installed."

print_info "Creating desktop launcher..."
cat > kjer.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Kjer Security Framework
Exec=npx electron .
Icon=$(pwd)/icon.png
Terminal=false
Categories=Utility;Security;
EOF
chmod +x kjer.desktop

# Copy to user's applications directory
sudo cp kjer.desktop "/usr/share/applications/kjer.desktop"
sudo chown root:root "/usr/share/applications/kjer.desktop"
sudo chmod 755 "/usr/share/applications/kjer.desktop"
print_success "Kjer Desktop app installed system-wide! You can now launch it from your application menu."
