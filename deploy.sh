#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -d "$DIR/dist" ]; then
    DIR="/home/gf/Проекти/Python/cockpit-yay"
fi

echo "=== Встановлення оновленого Cockpit AUR плагіна ==="
mkdir -p /usr/share/cockpit/aur
cp -v "$DIR"/dist/* /usr/share/cockpit/aur/
chown -R gf:gf /usr/share/cockpit/aur
chmod -R 755 /usr/share/cockpit/aur

if [ -d "$HOME/.local/share/cockpit" ]; then
    mkdir -p "$HOME/.local/share/cockpit/aur"
    cp -v "$DIR"/dist/* "$HOME/.local/share/cockpit/aur/"
fi

if [ -f "$DIR/backend/target/release/cockpit-aur-backend" ]; then
    mkdir -p /usr/libexec/cockpit-aur
    cp -v "$DIR/backend/target/release/cockpit-aur-backend" /usr/libexec/cockpit-aur/cockpit-aur-backend
    chmod 755 /usr/libexec/cockpit-aur/cockpit-aur-backend
fi

systemctl restart cockpit.service || true
echo "=== Оновлення завершено! Перезавантажте сторінку у браузері ==="
