#!/bin/bash
# Kjer Uninstaller Script for macOS
# Removes Kjer .app bundle, desktop entries, and optionally dependencies.

set -e

APP_NAME="Kjer"
APP_BUNDLE="$HOME/Applications/$APP_NAME.app"

read -p "Are you sure you want to uninstall $APP_NAME from $APP_BUNDLE? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi


# Remove .app bundle (admin required)
if [ -d "$APP_BUNDLE" ]; then
    sudo rm -rf "$APP_BUNDLE"
    echo "Removed $APP_BUNDLE."
fi

# Remove CLI symlinks
for link in /usr/local/bin/kjer "$HOME/.local/bin/kjer"; do
    if [ -L "$link" ] || [ -f "$link" ]; then
        sudo rm -f "$link" 2>/dev/null || rm -f "$link" 2>/dev/null
        echo "Removed CLI symlink: $link"
    fi
done

# Remove ~/.kjer/ state directory (initialization and activation data)
if [ -d "$HOME/.kjer" ]; then
    rm -rf "$HOME/.kjer"
    echo "Removed state directory: $HOME/.kjer"
fi

# Remove desktop shortcut (if exists)
if [ -f "$HOME/Desktop/$APP_NAME.app" ]; then
    rm "$HOME/Desktop/$APP_NAME.app"
    echo "Removed desktop shortcut."
fi

echo "$APP_NAME has been uninstalled from macOS."
