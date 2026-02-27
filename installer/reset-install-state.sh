#!/bin/bash
# Kjer Install State Reset
# Resets system integration so you can test a fresh install WITHOUT deleting
# the Kjer source files.
#
# Removes:
#   - /usr/local/bin/kjer            (system CLI symlink)
#   - ~/.local/bin/kjer              (user CLI symlink)
#   - ~/.kjer/                       (activation, license, init state)
#   - desktop/node_modules/          (optional: forces npm install to re-run)
#
# Does NOT remove:
#   - The Kjer source directory
#   - Python, Node.js, or any system packages
#
# Usage:
#   bash installer/reset-install-state.sh
#   bash installer/reset-install-state.sh --keep-node-modules

set -e

CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

KEEP_NODE_MODULES=false
for arg in "$@"; do
    [[ "$arg" == "--keep-node-modules" ]] && KEEP_NODE_MODULES=true
done

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Kjer Install State Reset${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  This resets Kjer to a pre-install state for fresh install testing."
echo "  Your Kjer source files will NOT be touched."
echo ""

# ── 1. Remove system CLI symlink (/usr/local/bin/kjer) ─────────────────────
if [ -L "/usr/local/bin/kjer" ] || [ -f "/usr/local/bin/kjer" ]; then
    sudo rm -f "/usr/local/bin/kjer"
    echo -e "  ${GREEN}✓${NC} Removed /usr/local/bin/kjer"
else
    echo -e "  ${YELLOW}·${NC} /usr/local/bin/kjer not found (already clean)"
fi

# ── 2. Remove user CLI symlink (~/.local/bin/kjer) ──────────────────────────
if [ -L "$HOME/.local/bin/kjer" ] || [ -f "$HOME/.local/bin/kjer" ]; then
    rm -f "$HOME/.local/bin/kjer"
    echo -e "  ${GREEN}✓${NC} Removed ~/.local/bin/kjer"
else
    echo -e "  ${YELLOW}·${NC} ~/.local/bin/kjer not found (already clean)"
fi

# ── 3. Remove ~/.kjer state (activation, license, init) ─────────────────────
if [ -d "$HOME/.kjer" ]; then
    rm -rf "$HOME/.kjer"
    echo -e "  ${GREEN}✓${NC} Removed ~/.kjer/ (activation & license state)"
else
    echo -e "  ${YELLOW}·${NC} ~/.kjer/ not found (already clean)"
fi

# ── 4. Optionally remove desktop/node_modules ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KJER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_MODULES="$KJER_ROOT/desktop/node_modules"

if [ "$KEEP_NODE_MODULES" = false ]; then
    if [ -d "$NODE_MODULES" ]; then
        rm -rf "$NODE_MODULES"
        echo -e "  ${GREEN}✓${NC} Removed desktop/node_modules/ (Electron will reinstall)"
    else
        echo -e "  ${YELLOW}·${NC} desktop/node_modules/ not found (already clean)"
    fi
else
    echo -e "  ${YELLOW}·${NC} Keeping desktop/node_modules/ (--keep-node-modules)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Reset complete. Ready for a fresh install.${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Next steps:"
echo -e "    ${CYAN}bash installer/kjer-install.sh${NC}   # install dependencies"
echo -e "    ${CYAN}kjer --gui${NC}                        # activate & initialize"
echo ""
