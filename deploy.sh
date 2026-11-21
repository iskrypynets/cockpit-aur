#!/usr/bin/env bash
# ==============================================================================
# deploy.sh - Canonical deployment & self-verification script for cockpit-aur
#
# Rules:
# 1. ALWAYS builds a full Arch Linux package via makepkg (NO partial file copying!).
# 2. ALWAYS cleans up any shadowing user overrides (~/.local/share/cockpit/aur).
# 3. ALWAYS installs cleanly via `pacman -U`.
# 4. Restarts cockpit service and socket.
# 5. ALWAYS runs full automated verification suite (tools/verify_deploy.py)
#    and FAILS with non-zero exit code if any test fails.
#
# Usage:
#   ./deploy.sh [vampa|local]   # Deploy to local machine (vampa)
#   ./deploy.sh plex            # Deploy to remote server (plex at 192.168.1.188)
#   ./deploy.sh all             # Deploy to BOTH vampa and plex
#   ./deploy.sh --skip-build    # Skip rebuilding package if already built
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REMOTE_PLEX="gf@192.168.1.188"

# Parse arguments
TARGET="local"
SKIP_BUILD=0

for arg in "$@"; do
    case "$arg" in
        vampa|local)
            TARGET="local"
            ;;
        plex)
            TARGET="plex"
            ;;
        all)
            TARGET="all"
            ;;
        --skip-build)
            SKIP_BUILD=1
            ;;
        -h|--help)
            echo "Usage: $0 [vampa|plex|all] [--skip-build]"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Usage: $0 [vampa|plex|all] [--skip-build]"
            exit 1
            ;;
    esac
done

# Determine package file dynamically from makepkg and PKGBUILD (no hardcoded pkgrel or arch)
PKG_FILE_PATH="$(makepkg --packagelist | head -n 1)"
PKG_FILE="$(basename "$PKG_FILE_PATH")"

# Read version from package.json or PKGBUILD
VERSION=$(node -p "require('./package.json').version")

echo -e "\033[1;36m============================================================\033[0m"
echo -e "\033[1;36m🚀 COCKPIT-AUR DEPLOYMENT PIPELINE (v${VERSION})\033[0m"
echo -e "\033[1;36mTarget: ${TARGET} | Package: ${PKG_FILE}\033[0m"
echo -e "\033[1;36m============================================================\033[0m"

# 1. Build Package
if [ "$SKIP_BUILD" -eq 1 ] && [ -f "$PKG_FILE" ]; then
    echo -e "\n\033[1;33m[1/3] Skipping build, using existing package: $PKG_FILE\033[0m"
else
    echo -e "\n\033[1;34m[1/3] Building clean Arch Linux package via makepkg...\033[0m"
    # Ensure frontend and backend are fresh
    (cd backend && cargo build --release --locked)
    npm run build
    cp -f src/manifest.json dist/
    cp -f src/index.html dist/

    # Build package with makepkg
    makepkg -f --nodeps
    if [ ! -f "$PKG_FILE" ]; then
        echo -e "\033[1;31mError: Package file $PKG_FILE was not created!\033[0m" >&2
        exit 1
    fi
    echo -e "\033[1;32m✓ Package built successfully: $PKG_FILE\033[0m"
fi

# Function to deploy locally to vampa
deploy_local() {
    echo -e "\n\033[1;34m[2/3] Installing package on LOCAL host (vampa)...\033[0m"
    # Remove any shadowing user override
    rm -rf "$HOME/.local/share/cockpit/aur"

    # Install package cleanly via pacman
    sudo pacman -U --noconfirm "$PKG_FILE"

    # Install unified terminal enhancements (Copy, Settings toggle, 1000 lines scrollback)
    if [ -f "tools/terminal.html" ]; then
        if [ -f "/usr/share/cockpit/systemd/terminal.css.gz.orig" ]; then
            sudo cp -f "/usr/share/cockpit/systemd/terminal.css.gz.orig" "/usr/share/cockpit/systemd/terminal.css.gz"
        fi
        sudo cp -f tools/terminal.html /usr/share/cockpit/systemd/terminal.html
        sudo chmod 644 /usr/share/cockpit/systemd/terminal.html
    fi

    # Restart Cockpit
    echo "Restarting Cockpit service & socket..."
    sudo systemctl restart cockpit.service cockpit.socket

    # Verify deployment
    echo -e "\n\033[1;34m[3/3] Running automated deployment self-test for local (vampa)...\033[0m"
    python3 tools/verify_deploy.py --name vampa --version "$VERSION"
}

# Function to deploy to plex
deploy_plex() {
    echo -e "\n\033[1;34m[2/3] Installing package on REMOTE host (plex: $REMOTE_PLEX)...\033[0m"
    # Transfer package and terminal.html to /tmp
    echo "Transferring $PKG_FILE and terminal.html to $REMOTE_PLEX:/tmp/..."
    scp -o BatchMode=yes "$PKG_FILE" tools/terminal.html "${REMOTE_PLEX}:/tmp/"

    # Install on remote, remove user overrides, install terminal.html, restart service
    echo "Installing package on remote via pacman -U and configuring terminal enhancements..."
    ssh -o BatchMode=yes "$REMOTE_PLEX" bash -s <<EOF
set -e
rm -rf "\$HOME/.local/share/cockpit/aur"
sudo pacman -U --noconfirm "/tmp/${PKG_FILE}"
rm -f "/tmp/${PKG_FILE}"
if [ -f "/tmp/terminal.html" ]; then
    if [ -f "/usr/share/cockpit/systemd/terminal.css.gz.orig" ]; then
        sudo cp -f "/usr/share/cockpit/systemd/terminal.css.gz.orig" "/usr/share/cockpit/systemd/terminal.css.gz"
    fi
    sudo cp -f /tmp/terminal.html /usr/share/cockpit/systemd/terminal.html
    sudo chmod 644 /usr/share/cockpit/systemd/terminal.html
    rm -f /tmp/terminal.html
fi
sudo systemctl restart cockpit.service cockpit.socket
EOF

    # Verify remote deployment
    echo -e "\n\033[1;34m[3/3] Running automated deployment self-test for remote (plex)...\033[0m"
    python3 tools/verify_deploy.py --remote "$REMOTE_PLEX" --name plex --version "$VERSION"
}

# Execute requested deployment
case "$TARGET" in
    local)
        deploy_local
        ;;
    plex)
        deploy_plex
        ;;
    all)
        deploy_local
        deploy_plex
        ;;
esac

echo -e "\n\033[1;32m============================================================\033[0m"
echo -e "\033[1;32m🎉 DEPLOYMENT AND VERIFICATION COMPLETED SUCCESSFULLY!\033[0m"
echo -e "\033[1;32mTarget(s): ${TARGET} | Version: ${VERSION}\033[0m"
echo -e "\033[1;32m============================================================\033[0m"
