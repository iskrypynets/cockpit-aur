#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "==> Ensuring yay binary exists in docker/ ..."
if [ ! -f "docker/yay" ]; then
    if command -v yay >/dev/null 2>&1; then
        echo "Copying host yay binary from $(command -v yay)..."
        cp "$(command -v yay)" docker/yay
        chmod +x docker/yay
    else
        echo "Downloading precompiled yay..."
        YAY_VER="12.4.2"
        curl -sSL "https://github.com/Jguer/yay/releases/download/v${YAY_VER}/yay_${YAY_VER}_x86_64.tar.gz" | tar -xz -C /tmp
        cp "/tmp/yay_${YAY_VER}_x86_64/yay" docker/yay
        chmod +x docker/yay
    fi
fi

echo "==> Building backend binary (release)..."
if [ ! -f "backend/target/release/cockpit-aur-backend" ]; then
    (cd backend && cargo build --release --locked)
fi

echo "==> Building frontend package..."
if [ ! -f "dist/index.js" ]; then
    npm ci
    npm run build
    cp src/manifest.json dist/
    cp src/index.html dist/
fi

echo "==> Building Podman/Docker image cockpit-aur:local ..."
podman build -t cockpit-aur:local -f docker/Dockerfile .

echo "==> Done! You can run the container with:"
echo "    systemctl --user restart cockpit-aur.service"
echo "    or test directly:"
echo "    podman run --rm -p 9090:9090 localhost/cockpit-aur:local"
