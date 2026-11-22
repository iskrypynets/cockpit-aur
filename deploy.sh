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
NO_BUMP=0

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
        --no-bump)
            NO_BUMP=1
            ;;
        -h|--help)
            echo "Usage: $0 [vampa|plex|all] [--skip-build] [--no-bump]"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Usage: $0 [vampa|plex|all] [--skip-build] [--no-bump]"
            exit 1
            ;;
    esac
done

# Read upstream version from package.json
VERSION=$(node -p "require('./package.json').version")

# 1. Build Package
if [ "$SKIP_BUILD" -eq 1 ]; then
    PKG_FILE_PATH="$(makepkg --packagelist | head -n 1)"
    PKG_FILE="$(basename "$PKG_FILE_PATH")"
    if [ -f "$PKG_FILE" ]; then
        echo -e "\n\033[1;33m[1/3] Skipping build, using existing package: $PKG_FILE\033[0m"
    fi
else
    # Auto-bump patch/package release version (pkgrel) on each deployment build
    CURRENT_PKGREL=$(grep '^pkgrel=' PKGBUILD | cut -d'=' -f2 | tr -d ' ')
    if [ "$NO_BUMP" -eq 0 ]; then
        NEW_PKGREL=$((CURRENT_PKGREL + 1))
        sed -i "s/^pkgrel=.*/pkgrel=${NEW_PKGREL}/" PKGBUILD
        echo -e "\033[1;35m📌 Bumped package patch release: pkgrel ${CURRENT_PKGREL} -> ${NEW_PKGREL}\033[0m"
    else
        NEW_PKGREL="$CURRENT_PKGREL"
    fi

    # Determine fresh package file name dynamically
    PKG_FILE_PATH="$(makepkg --packagelist | head -n 1)"
    PKG_FILE="$(basename "$PKG_FILE_PATH")"

    echo -e "\033[1;36m============================================================\033[0m"
    echo -e "\033[1;36m🚀 COCKPIT-AUR DEPLOYMENT PIPELINE (v${VERSION}-${NEW_PKGREL})\033[0m"
    echo -e "\033[1;36mTarget: ${TARGET} | Package: ${PKG_FILE}\033[0m"
    echo -e "\033[1;36m============================================================\033[0m"

    echo -e "\n\033[1;34m[1/3] Building clean Arch Linux package via makepkg (${PKG_FILE})...\033[0m"
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

# Safety check: Wait for running upgrade operations to finish cleanly before deploying
wait_for_safe_deploy() {
    local host_type="$1" # "local" or "remote"
    local poll_interval=4
    local waited=0
    local max_wait=7200 # Up to 2 hours for long builds

    while true; do
        local is_busy=0
        local reason=""

        if [ "$host_type" = "local" ]; then
            if [ -f "/var/lib/pacman/db.lck" ]; then
                is_busy=1
                reason="pacman database is locked (/var/lib/pacman/db.lck exists)"
            elif [ -f "/tmp/cockpit-aur-operation.json" ]; then
                local pid
                pid=$(grep -o '"pid":[0-9]*' /tmp/cockpit-aur-operation.json 2>/dev/null | cut -d':' -f2 || true)
                local status
                status=$(grep -o '"status":"[^"]*"' /tmp/cockpit-aur-operation.json 2>/dev/null | cut -d'"' -f4 || true)
                if [ "$status" = "running" ] && [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
                    is_busy=1
                    reason="AUR upgrade operation is active (PID: $pid)"
                fi
            fi
            if [ "$is_busy" -eq 0 ]; then
                if pgrep -x cockpit-aur-backend >/dev/null 2>&1; then
                    is_busy=1
                    reason="cockpit-aur-backend is running"
                elif pgrep -x yay >/dev/null 2>&1; then
                    is_busy=1
                    reason="yay package manager is running"
                elif pgrep -x makepkg >/dev/null 2>&1; then
                    is_busy=1
                    reason="makepkg compilation is running"
                elif pgrep -x pacman >/dev/null 2>&1; then
                    is_busy=1
                    reason="pacman transaction is running"
                fi
            fi
        else
            local remote_check
            remote_check=$(ssh -o BatchMode=yes "$REMOTE_PLEX" bash -c '
                if [ -f "/var/lib/pacman/db.lck" ]; then
                    echo "LOCKED:pacman database is locked (/var/lib/pacman/db.lck)"
                    exit 0
                fi
                if [ -f "/tmp/cockpit-aur-operation.json" ]; then
                    pid=$(grep -o "\"pid\":[0-9]*" /tmp/cockpit-aur-operation.json 2>/dev/null | cut -d":" -f2 || true)
                    status=$(grep -o "\"status\":\"[^\"]*\"" /tmp/cockpit-aur-operation.json 2>/dev/null | cut -d"\"" -f4 || true)
                    if [ "$status" = "running" ] && [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
                        echo "LOCKED:AUR upgrade is active (PID: $pid)"
                        exit 0
                    fi
                fi
                if pgrep -x cockpit-aur-backend >/dev/null 2>&1; then
                    echo "LOCKED:cockpit-aur-backend is running"
                elif pgrep -x yay >/dev/null 2>&1; then
                    echo "LOCKED:yay package manager is running"
                elif pgrep -x makepkg >/dev/null 2>&1; then
                    echo "LOCKED:makepkg compilation is running"
                elif pgrep -x pacman >/dev/null 2>&1; then
                    echo "LOCKED:pacman transaction is running"
                fi
            ' 2>/dev/null || true)
            if [ -n "$remote_check" ]; then
                is_busy=1
                reason="${remote_check#LOCKED:}"
            fi
        fi

        if [ "$is_busy" -eq 1 ]; then
            echo -e "\033[1;33m⏳ [Safe Deploy Gate] ${host_type} host is busy: ${reason}.\033[0m"
            echo -e "\033[1;33m   Waiting for ongoing upgrade/build to finish safely... (${waited}s elapsed)\033[0m"
            sleep "$poll_interval"
            waited=$((waited + poll_interval))
            if [ "$waited" -ge "$max_wait" ]; then
                echo -e "\033[1;31m❌ [Safe Deploy Gate] Timed out waiting for active operations to complete.\033[0m" >&2
                return 1
            fi
        else
            if [ "$waited" -gt 0 ]; then
                echo -e "\033[1;32m✓ [Safe Deploy Gate] Ongoing operation finished. Safe to proceed with deploy on ${host_type}.\033[0m"
            else
                echo -e "\033[1;32m✓ [Safe Deploy Gate] No active operations on ${host_type}. Safe to deploy.\033[0m"
            fi
            break
        fi
    done
}

# Function to deploy locally to vampa
deploy_local() {
    wait_for_safe_deploy "local"

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

    # Ensure Cockpit systemd core files are in pristine official state
    if [ -f "/usr/share/cockpit/systemd/overview.js.gz.orig" ]; then
        sudo cp -f "/usr/share/cockpit/systemd/overview.js.gz.orig" "/usr/share/cockpit/systemd/overview.js.gz"
        sudo rm -f "/usr/share/cockpit/systemd/overview.js.gz.orig"
    fi
    local cockpit_pkg
    cockpit_pkg="$(ls -1 /var/cache/pacman/pkg/cockpit-[0-9]*.pkg.tar.zst 2>/dev/null | sort -V | tail -n 1 || true)"
    if [ -n "$cockpit_pkg" ] && [ -f "$cockpit_pkg" ]; then
        tar -xOf "$cockpit_pkg" usr/share/cockpit/systemd/overview.js.gz 2>/dev/null | sudo tee /usr/share/cockpit/systemd/overview.js.gz >/dev/null || true
        tar -xOf "$cockpit_pkg" usr/share/cockpit/systemd/index.html 2>/dev/null | sudo tee /usr/share/cockpit/systemd/index.html >/dev/null || true
        tar -xOf "$cockpit_pkg" usr/share/cockpit/systemd/manifest.json 2>/dev/null | sudo tee /usr/share/cockpit/systemd/manifest.json >/dev/null || true
        tar -xOf "$cockpit_pkg" usr/share/cockpit/branding/arch/branding.css 2>/dev/null | sudo tee /usr/share/cockpit/branding/arch/branding.css >/dev/null || true
        sudo chmod 644 /usr/share/cockpit/systemd/overview.js.gz /usr/share/cockpit/systemd/index.html /usr/share/cockpit/systemd/manifest.json /usr/share/cockpit/branding/arch/branding.css 2>/dev/null || true
    fi

    # Install clean plain-text MOTD generator
    if [ -f "tools/generate_motd.sh" ]; then
        sudo mkdir -p /opt/arch-motd
        sudo cp -f tools/generate_motd.sh /opt/arch-motd/generate_motd.sh
        sudo chmod +x /opt/arch-motd/generate_motd.sh
        sudo /opt/arch-motd/generate_motd.sh
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
    wait_for_safe_deploy "remote"

    echo -e "\n\033[1;34m[2/3] Installing package on REMOTE host (plex: $REMOTE_PLEX)...\033[0m"
    # Transfer package, terminal.html, and generate_motd.sh to /tmp
    echo "Transferring $PKG_FILE, terminal.html, and generate_motd.sh to $REMOTE_PLEX:/tmp/..."
    scp -o BatchMode=yes "$PKG_FILE" tools/terminal.html tools/generate_motd.sh "${REMOTE_PLEX}:/tmp/"

    # Install on remote, remove user overrides, restore pristine core, install terminal & motd generator, restart service
    echo "Installing package on remote via pacman -U and configuring enhancements..."
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
# Restore pristine Cockpit core files on remote
if [ -f "/usr/share/cockpit/systemd/overview.js.gz.orig" ]; then
    sudo cp -f "/usr/share/cockpit/systemd/overview.js.gz.orig" "/usr/share/cockpit/systemd/overview.js.gz"
    sudo rm -f "/usr/share/cockpit/systemd/overview.js.gz.orig"
fi
cockpit_pkg="\$(ls -1 /var/cache/pacman/pkg/cockpit-[0-9]*.pkg.tar.zst 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "\$cockpit_pkg" ] && [ -f "\$cockpit_pkg" ]; then
    tar -xOf "\$cockpit_pkg" usr/share/cockpit/systemd/overview.js.gz 2>/dev/null | sudo tee /usr/share/cockpit/systemd/overview.js.gz >/dev/null || true
    tar -xOf "\$cockpit_pkg" usr/share/cockpit/systemd/index.html 2>/dev/null | sudo tee /usr/share/cockpit/systemd/index.html >/dev/null || true
    tar -xOf "\$cockpit_pkg" usr/share/cockpit/systemd/manifest.json 2>/dev/null | sudo tee /usr/share/cockpit/systemd/manifest.json >/dev/null || true
    tar -xOf "\$cockpit_pkg" usr/share/cockpit/branding/arch/branding.css 2>/dev/null | sudo tee /usr/share/cockpit/branding/arch/branding.css >/dev/null || true
    sudo chmod 644 /usr/share/cockpit/systemd/overview.js.gz /usr/share/cockpit/systemd/index.html /usr/share/cockpit/systemd/manifest.json /usr/share/cockpit/branding/arch/branding.css 2>/dev/null || true
fi
if [ -f "/tmp/generate_motd.sh" ]; then
    sudo mkdir -p /opt/arch-motd
    sudo cp -f /tmp/generate_motd.sh /opt/arch-motd/generate_motd.sh
    sudo chmod +x /opt/arch-motd/generate_motd.sh
    sudo /opt/arch-motd/generate_motd.sh
    rm -f /tmp/generate_motd.sh
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
