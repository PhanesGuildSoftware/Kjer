#!/bin/bash
# Kjer Uninstaller Script for Linux
# Removes Kjer files, desktop entries, and dependencies if desired.

set -e

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Kjer"

read -p "Are you sure you want to uninstall $APP_NAME from $INSTALL_DIR? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi


# Remove desktop entry (if exists)
if [ -f "/usr/share/applications/$APP_NAME.desktop" ]; then
    sudo rm "/usr/share/applications/$APP_NAME.desktop"
    echo "Removed desktop entry."
fi

# Remove symlinks from /usr/local/bin (if exists)
if [ -L "/usr/local/bin/kjer" ]; then
    sudo rm "/usr/local/bin/kjer"
    echo "Removed CLI symlink: /usr/local/bin/kjer"
fi

# Remove user-level CLI symlink (created by GUI initialization)
if [ -L "$HOME/.local/bin/kjer" ] || [ -f "$HOME/.local/bin/kjer" ]; then
    rm -f "$HOME/.local/bin/kjer"
    echo "Removed CLI symlink: $HOME/.local/bin/kjer"
fi

# Remove ~/.kjer/ state directory (initialization and activation data)
if [ -d "$HOME/.kjer" ]; then
    rm -rf "$HOME/.kjer"
    echo "Removed state directory: $HOME/.kjer"
fi

# Remove main install directory
read -p "Remove all Kjer files in $INSTALL_DIR? [y/N]: " confirm_dir
if [[ "$confirm_dir" =~ ^[Yy]$ ]]; then
    cd "$INSTALL_DIR/.."
    sudo rm -rf "$APP_NAME"
    echo "Removed $APP_NAME directory."
fi

echo "$APP_NAME has been uninstalled."
