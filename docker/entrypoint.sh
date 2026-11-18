#!/bin/bash
set -e

mkdir -p /run/cockpit
mkdir -p /run/user/1000
chown -R gf:gf /run/user/1000 2>/dev/null || true

# Dynamic link to sync db:
mkdir -p /var/lib/pacman
if [ -d "/tmp/checkup-db-1000/sync" ]; then
    echo "Linking /var/lib/pacman/sync -> /tmp/checkup-db-1000/sync"
    rm -rf /var/lib/pacman/sync
    ln -sf /tmp/checkup-db-1000/sync /var/lib/pacman/sync
elif [ -d "/host/var/lib/pacman/sync" ]; then
    echo "Linking /var/lib/pacman/sync -> /host/var/lib/pacman/sync"
    rm -rf /var/lib/pacman/sync
    ln -sf /host/var/lib/pacman/sync /var/lib/pacman/sync
fi

echo "=========================================================="
echo " Starting Cockpit Yay on http://localhost:9090"
echo " Web UI: http://localhost:9090/@localhost/yay"
echo "=========================================================="

exec /usr/lib/cockpit/cockpit-ws --port=9090 --no-tls --local-session=/usr/bin/cockpit-bridge "$@"
